// 레벨별로 "무엇이 바뀔지"를 계산한다. 여기서는 절대 쓰지 않는다 (dry-run 전용).
// apply.js가 이 결과를 받아 실제로 쓴다. UI는 항상 plan → 미리보기 → apply 순서로 동작한다.
import fs from 'node:fs';
import path from 'node:path';
import { harnessRoot, readJson, toolchain } from './paths.js';
import { harnessVersion } from './registry.js';
import { levelById } from './levels.js';

const BEGIN = '<!-- kmjharness:begin — kmjh가 관리합니다. 직접 수정하지 마세요 -->';
const END = '<!-- kmjharness:end -->';

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const tpl = (...seg) => read(path.join(harnessRoot, ...seg));

const slash = (p) => String(p).replaceAll('\\', '/');

function action(repo, relRaw, after, kind, note, managed = false) {
  const rel = slash(relRaw);
  const abs = path.join(repo.dir, rel);
  const before = read(abs);
  if (before === after) return { rel, kind: 'skip', note: '이미 동일함', before, after, managed };
  return { rel, kind: before === null ? 'create' : kind, note, before, after, managed };
}

// 하네스가 대체하는 옛 설정 파일을 지운다. 임의 파일이 아니라
// toolchain.json의 supersedes 목록에 있는 것만 대상이 된다.
function removal(repo, relRaw, note) {
  const rel = slash(relRaw);
  const before = read(path.join(repo.dir, rel));
  if (before === null) return null;
  return { rel, kind: 'delete', note, before, after: null, remove: true };
}



// 하네스 전용 워크플로 파일. 레포의 ci.yml 과 이름이 달라 충돌하지 않는다.
export const WORKFLOW_REL = '.github/workflows/kmjh-verify.yml';

function renderWorkflow(repo, level) {
  const tc = toolchain();
  const pm = repo.packageManager === 'none' ? 'npm' : repo.packageManager;
  const file = level >= 2 ? 'kmjh-verify.yml' : 'kmjh-verify.warn.yml';
  const install = pm === 'pnpm' ? 'pnpm install --frozen-lockfile'
    : pm === 'yarn' ? 'yarn install --immutable' : 'npm ci';
  const verify = pm === 'npm' ? 'npm run verify' : `${pm} verify`;

  return (tpl('profiles', 'base', 'files', file) || '')
    .replaceAll('{{REPO}}', tc.harness.repo)
    .replaceAll('{{REF}}', tc.harness.ref)
    .replaceAll('{{PM_IS_PNPM}}', String(pm === 'pnpm'))
    .replaceAll('{{PNPM}}', String(tc.packageManager).split('@')[1] || '10')
    .replaceAll('{{NODE}}', tc.node)
    .replaceAll('{{INSTALL_CMD}}', install)
    .replaceAll('{{VERIFY_CMD}}', verify)
    .replaceAll('{{PM}}', pm);
}

// 패키지 매니저마다 스크립트 호출 방식이 다르다. npm만 `run`이 필요하다.
const runCmd = (pm, script) => (pm === 'npm' || pm === 'none' ? `npm run ${script}` : `${pm} ${script}`);

// ── AGENTS.md ───────────────────────────────────────────────
function buildAgentsMd(repo, userSection) {
  const pm = repo.packageManager === 'none' ? 'npm' : repo.packageManager;
  const base = (tpl('profiles', 'base', 'AGENTS.base.md') || '').replaceAll('{{PM}}', pm);
  const frag = tpl('profiles', repo.detectedProfile, 'AGENTS.fragment.md') || '';
  const managed = [BEGIN, '', base.trim(), '', frag.trim(), '', END].join('\n');
  const user = (userSection || '').trim()
    || '## 이 프로젝트만의 규칙\n\n<!-- 여기부터는 당신의 영역입니다. kmjh는 이 아래를 건드리지 않습니다. -->\n';
  return `# ${repo.name}\n\n${managed}\n\n${user}\n`;
}

function existingUserSection(repo) {
  const cur = read(path.join(repo.dir, 'AGENTS.md'));
  if (cur && cur.includes(END)) return cur.slice(cur.indexOf(END) + END.length);
  if (cur) return cur;                       // 마커 없는 기존 AGENTS.md는 통째로 보존
  const claude = read(path.join(repo.dir, 'CLAUDE.md'));
  if (claude && claude.trim() !== '@AGENTS.md') {
    return `## 이 프로젝트만의 규칙\n\n<!-- 아래는 기존 CLAUDE.md에서 이관된 내용입니다. 공통 규약과 겹치는 부분은 정리하세요. -->\n\n${claude.replace(/^#\s+CLAUDE\.md\s*/m, '').trim()}\n`;
  }
  return null;
}

// ── package.json 변형 ────────────────────────────────────────
// L2와 L3가 같은 파일을 건드리므로, 변형을 순서대로 쌓고 마지막에 한 번만 액션으로 만든다.
function transformPackage(repo, level) {
  const pkg = JSON.parse(JSON.stringify(repo.pkg));
  const pm = repo.packageManager === 'none' ? 'npm' : repo.packageManager;
  const s = pkg.scripts || (pkg.scripts = {});
  const notes = [];

  if (level >= 2) {
    const added = [];
    const put = (name, value) => { if (!(name in s)) { s[name] = value; added.push(name); } };
    if (s['type-check'] && !s['typecheck']) put('typecheck', s['type-check']);
    put('lint', 'eslint .');
    put('lint:fix', 'eslint . --fix');
    put('format', 'prettier --write .');
    put('format:check', 'prettier --check .');
    if (s.test) put('test:watch', s.test.replace(/\s+run\b/, ''));
    put('test:coverage', (s.test || 'vitest run') + ' --coverage');
    const chain = ['lint', 'typecheck', 'test', 'build'].filter((n) => n in s);
    put('verify', chain.map((n) => runCmd(pm, n)).join(' && '));
    if (added.length) notes.push(`스크립트 ${added.length}개 추가: ${added.join(', ')}`);
  }

  if (level >= 3) {
    // ESLint 9 flat config는 --ext 옵션을 없앴다. 남아 있으면 실행 자체가 실패한다.
    const fixed = [];
    for (const k of ['lint', 'lint:fix']) {
      if (s[k] && /--ext\b/.test(s[k])) {
        s[k] = s[k].replace(/\s*--ext\s+\S+/g, '');
        fixed.push(k);
      }
    }
    if (fixed.length) notes.push(`${fixed.join(', ')}에서 --ext 제거 (ESLint 9에서 삭제된 옵션)`);

    const lt = toolchain().lintToolchain || { add: {}, remove: [] };
    const dev = pkg.devDependencies || (pkg.devDependencies = {});
    const changed = [];
    for (const [name, ver] of Object.entries(lt.add)) {
      if (dev[name] !== ver) { changed.push(`${name}@${ver}`); dev[name] = ver; }
    }
    const removed = [];
    for (const name of lt.remove) {
      if (name in dev) { delete dev[name]; removed.push(name); }
    }
    pkg.devDependencies = Object.fromEntries(Object.entries(dev).sort(([a], [b]) => a.localeCompare(b)));
    if (changed.length) notes.push(`린트 의존성 ${changed.length}개 갱신`);
    if (removed.length) notes.push(`구식 의존성 제거: ${removed.join(', ')}`);
  }

  return { pkg, note: notes.join(' · ') || '변경 없음' };
}

// ── 계획 ────────────────────────────────────────────────────
export function planLevel(repo, targetLevel) {
  const lv = levelById(targetLevel);
  if (!lv.implemented) {
    return {
      repo: repo.name, fromLevel: repo.level, toLevel: targetLevel,
      unavailable: true,
      reason: `${lv.name}은 아직 구현되지 않았습니다. 이 단계가 할 일: ${lv.writes.join(' · ')}`,
      actions: [], changed: 0,
    };
  }

  const acts = [];
  const warnings = [];

  // L0 — 핸드셰이크
  const cfg = {
    $comment: 'kmjHarness 핸드셰이크 (프로젝트 측). kmjh가 관리합니다.',
    harness: harnessVersion(),
    profile: repo.detectedProfile,
    addons: repo.detectedAddons,
    level: targetLevel,
    release: repo.config?.release ?? false,
  };
  acts.push(action(repo, 'kmjharness.json', JSON.stringify(cfg, null, 2) + '\n', 'update', '핸드셰이크 선언'));

  // L1 — 에이전트 컨텍스트 + 공통 파일
  if (targetLevel >= 1) {
    const userSection = existingUserSection(repo);
    const claudeExisting = read(path.join(repo.dir, 'CLAUDE.md'));
    const migrating = Boolean(claudeExisting && claudeExisting.trim() !== '@AGENTS.md' && !read(path.join(repo.dir, 'AGENTS.md')));

    acts.push(action(repo, 'AGENTS.md', buildAgentsMd(repo, userSection), 'update',
      migrating ? '기존 CLAUDE.md 내용을 사용자 영역으로 이관' : '관리 블록만 갱신, 사용자 영역 보존'));
    acts.push(action(repo, 'CLAUDE.md', '@AGENTS.md\n', 'update',
      migrating ? '내용은 AGENTS.md로 옮기고 import 한 줄만 남김' : 'Claude Code 호환용 import'));
    acts.push(action(repo, '.editorconfig', tpl('profiles', 'base', 'files', '.editorconfig'), 'update', '공통 에디터 설정'));

    const cur = readJson(path.join(repo.dir, '.claude', 'settings.json'), {});
    const merged = { ...cur, permissions: { ...(cur.permissions || {}), additionalDirectories: ['../kmjHarness'] } };
    acts.push(action(repo, '.claude/settings.json', JSON.stringify(merged, null, 2) + '\n', 'merge',
      '기존 키는 보존하고 additionalDirectories만 병합'));

    // 레포의 ci.yml 은 절대 건드리지 않는다. 하네스 전용 파일을 따로 놓아 충돌 자체를 없앤다.
    // L1은 경고 모드(실패해도 머지 안 막음), L2에서 차단 모드로 바뀐다.
    acts.push(action(repo, WORKFLOW_REL, renderWorkflow(repo, targetLevel), 'update',
      targetLevel >= 2 ? '차단 모드 — 공용 워크플로 호출' : '경고 모드 — 실패해도 머지를 막지 않음', true));
  }

  // L2 — 포맷터 · 줄바꿈
  if (targetLevel >= 2) {
    acts.push(action(repo, '.prettierrc', tpl('profiles', 'base', 'files', 'prettierrc.json'), 'update', '공통 포맷 규칙', true));
    acts.push(action(repo, '.gitattributes', tpl('profiles', 'base', 'files', 'gitattributes'), 'update',
      '줄바꿈 정규화 — "줄바꿈만 다른데 변경돼 보이는" 현상을 없앤다', true));
  }

  // L3 — ESLint 9 flat config
  if (targetLevel >= 3) {
    const shared = tpl('profiles', repo.detectedProfile, 'eslint.config.js');
    if (!shared) {
      warnings.push(`${repo.detectedProfile} 프로파일에는 아직 공용 ESLint 설정이 없습니다.`);
    } else {
      acts.push(action(repo, '.kmjharness/eslint.config.js', shared, 'update', '공용 flat config', true));

      const rootRel = 'eslint.config.js';
      if (!read(path.join(repo.dir, rootRel))) {
        acts.push(action(repo, rootRel, tpl('profiles', repo.detectedProfile, 'eslint.root.js'), 'create',
          '공용 설정을 import 하는 얇은 파일 — 프로젝트 예외는 여기에'));
      } else {
        acts.push({ rel: rootRel, kind: 'skip',
          note: '기존 설정 유지 — .kmjharness/eslint.config.js 를 import 하도록 직접 바꾸세요', before: null, after: null });
      }

      for (const old of (toolchain().lintToolchain?.supersedes || [])) {
        const r = removal(repo, old, 'ESLint 9 flat config가 대체 — 남아 있으면 혼동만 준다');
        if (r) acts.push(r);
      }
      warnings.push('적용 후 반드시 의존성을 다시 설치하세요 (pnpm install / npm install). 그 전에는 lint가 실패합니다.');
    }
  }

  // package.json은 여러 레벨이 건드리므로 마지막에 한 번만
  if (targetLevel >= 2 && repo.pkg) {
    const { pkg, note } = transformPackage(repo, targetLevel);
    acts.push(action(repo, 'package.json', JSON.stringify(pkg, null, 2) + '\n', 'merge',
      note + ' (기존 스크립트는 그대로)'));
  }

  return {
    repo: repo.name,
    fromLevel: repo.level,
    toLevel: targetLevel,
    actions: acts,
    warnings,
    changed: acts.filter((a) => a.kind !== 'skip').length,
  };
}
