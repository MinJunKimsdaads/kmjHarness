// 레벨별로 "무엇이 바뀔지"를 계산한다. 여기서는 절대 쓰지 않는다 (dry-run 전용).
// apply.js가 이 결과를 받아 실제로 쓴다. UI는 항상 plan → 미리보기 → apply 순서로 동작한다.
import fs from 'node:fs';
import path from 'node:path';
import { harnessRoot, readJson, toolchain } from './paths.js';
import { BEGIN, END } from './markers.js';
import { insertStep, hasStep } from './verifyscript.js';
import { harnessVersion } from './registry.js';
import { levelById } from './levels.js';
import { profileFragments, profileFile, resolveLayers } from './profiles.js';
import { oneShotTest, testRunner } from './testscript.js';
import { hasEslintConfig, harnessShipsEslint, lintUsesEslint } from './eslintcfg.js';



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

// 'none'(락파일 없음)은 npm 으로 본다. 여러 곳에서 쓰므로 한 곳에 둔다.
const pmOf = (repo) => (repo.packageManager === 'none' ? 'npm' : repo.packageManager);

// 패키지 매니저마다 스크립트 호출 방식이 다르다. npm만 `run`이 필요하다.
const runCmd = (pm, script) => (pm === 'npm' || pm === 'none' ? `npm run ${script}` : `${pm} ${script}`);

// 레포가 선언한 프로파일이 우선, 없으면 감지값 (scan.js 참고)
const profileOf = (repo) => repo.profile ?? repo.detectedProfile;

// ── AGENTS.md ───────────────────────────────────────────────
function buildAgentsMd(repo, userSection) {
  const pm = repo.packageManager === 'none' ? 'npm' : repo.packageManager;
  // npm 은 스크립트를 `npm run verify` 로 불러야 한다 (`npm verify` 는 없는 명령)
  const base = (tpl('profiles', 'base', 'AGENTS.base.md') || '')
    .replaceAll('{{VERIFY}}', runCmd(pm, 'verify'))
    .replaceAll('{{PM}}', pm);
  // 프로파일 조각은 상속 사슬을 따라 조상 → 자손 순으로 이어진다 (profile.json 이 없으면 자기 것 하나).
  const frag = profileFragments(profileOf(repo));
  // 바깥 층(kmjharness.json 의 layers)은 맨 끝에 붙는다. 못 읽은 층은 계획 경고로만 알린다.
  const layers = resolveLayers(repo).filter((l) => l.ok).map((l) => l.fragment);
  const managed = [BEGIN, '', base.trim(), '', frag.trim(), '', ...layers.flatMap((t) => [t, '']), END].join('\n');
  // 기본 문구도 trim 한다 — 안 하면 처음 만든 AGENTS.md 끝에 빈 줄이 하나 더 생겨,
  // 바로 다음 계획이 그 빈 줄을 지우려 해서 '표준 다시 적용'이 영영 뜬다.
  const user = (userSection || '').trim()
    || '## 이 프로젝트만의 규칙\n\n<!-- 여기부터는 당신의 영역입니다. kmjh는 이 아래를 건드리지 않습니다. -->';
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
// 선언된 버전 범위를 비교한다. 표준은 '최소선'이지 '고정값'이 아니다.
// 같은 메이저에서 레포가 표준보다 앞서 있으면 그대로 둔다 — 앞선 레포를 뒤로 끌어당기면 안 된다.
const semver = (r) => String(r || '').replace(/^[\^~>=<\s]+/, '').split('.').map((n) => parseInt(n, 10) || 0);
function aheadOrEqual(current, standard) {
  const c = semver(current), s = semver(standard);
  // 방향만 본다. 메이저가 달라도 레포가 앞서 있으면 그대로 둔다 —
  // 표준은 '최소선'이므로 어떤 경우에도 레포를 뒤로 끌어당기지 않는다.
  for (let i = 0; i < 3; i++) {
    if ((c[i] ?? 0) > (s[i] ?? 0)) return true;
    if ((c[i] ?? 0) < (s[i] ?? 0)) return false;
  }
  return true;                                           // 같으면 그대로
}

// 하네스가 만드는 verify 문자열. lint 를 넣을지만 다르다.
const verifyChain = (pm, s, withLint) =>
  ['lint', 'typecheck', 'test', 'build'].filter((n) => n in s && (withLint || n !== 'lint')).map((n) => runCmd(pm, n)).join(' && ');

function transformPackage(repo, level) {
  const pkg = JSON.parse(JSON.stringify(repo.pkg));
  const pm = pmOf(repo);
  const s = pkg.scripts || (pkg.scripts = {});
  const notes = [];

  if (level >= 2) {
    const added = [];
    const put = (name, value) => { if (!(name in s)) { s[name] = value; added.push(name); } };
    const userLint = s.lint;                       // 하네스가 넣기 전의 lint (없으면 undefined)
    if (s['type-check'] && !s['typecheck']) put('typecheck', s['type-check']);

    // test 가 watch 모드면 verify 가 CI에서 영원히 멈춘다. 이건 반드시 고쳐야 한다.
    // 원래 값은 test:watch 로 보존하므로 잃는 것이 없다.
    // 아는 러너(vitest · jest)만 고친다 — core/testscript.js 참고. node --test 같은 것은 그대로 둔다.
    const fixed = s.test ? oneShotTest(s.test) : null;
    if (fixed) {
      const oneShot = s['test:run'] || fixed;
      if (!s['test:watch']) { s['test:watch'] = s.test; added.push('test:watch'); }
      notes.push(`test 를 1회 실행으로 교체 ("${s.test}" → "${oneShot}", 원래 값은 test:watch 로 보존) — watch 모드면 verify가 CI에서 멈춘다`);
      s.test = oneShot;
    }

    put('lint', 'eslint .');
    put('lint:fix', 'eslint . --fix');
    put('format', 'prettier --write .');
    put('format:check', 'prettier --check .');
    // watch · coverage 변형은 방법을 아는 러너에만 만든다 (모르는 러너에 플래그를 붙이면 깨진 명령이 된다)
    const runner = testRunner(s.test);
    if (runner === 'vitest') put('test:watch', s.test.replace(/\s+run\b/, ''));
    if (runner === 'jest') put('test:watch', `${s.test} --watch`);
    if (runner === 'vitest' || runner === 'jest' || !s.test) put('test:coverage', (s.test || 'vitest run') + ' --coverage');

    // ESLint 설정이 없으면(L3 전) lint 를 verify 에 넣지 않는다 — 넣으면 verify 가 설정 없음으로 실패해 막힌다.
    // 설정이 이미 있거나, 이번에 L3로 가서 하네스가 설정을 넣어 주거나, lint 가 ESLint 가 아닌 다른 도구면 넣는다.
    const lintReady = hasEslintConfig(repo) || (level >= 3 && harnessShipsEslint(repo))
      || (userLint !== undefined && !lintUsesEslint(userLint));
    // 이을 스크립트가 하나도 없으면 빈 verify 를 만들지 않는다 (doctor 가 '없음'으로 알린다)
    if (verifyChain(pm, s, lintReady)) put('verify', verifyChain(pm, s, lintReady));
    if (added.length) notes.push(`스크립트 ${added.length}개 추가: ${added.join(', ')}`);
  }

  if (level >= 4) {
    const tc = toolchain();
    const et = tc.enforceToolchain || { add: {}, prepare: null };
    const dev = pkg.devDependencies || (pkg.devDependencies = {});
    const added4 = [];
    for (const [name, ver] of Object.entries(et.add)) {
      if (dev[name] === ver) continue;
      if (dev[name] && aheadOrEqual(dev[name], ver)) continue;      // 이미 표준 이상이면 둔다
      dev[name] = ver; added4.push(name);
    }
    pkg.devDependencies = Object.fromEntries(Object.entries(dev).sort(([a], [b]) => a.localeCompare(b)));
    if (added4.length) notes.push(`강제 도구 추가: ${added4.join(', ')}`);

    // lefthook 은 install 뒤 prepare 에서 .git/hooks 에 자리를 잡는다.
    // '|| true' 는 .git 이 없는 환경(일부 CI·Docker)에서 설치가 통째로 실패하지 않게 한다.
    if (et.prepare && !s.prepare) { s.prepare = `${et.prepare} || true`; notes.push('prepare 스크립트 추가 (훅 설치)'); }

    // verify 에 format:check 를 '끼워 넣는다' — 기존 스텝은 그대로 둔다
    if (s.verify && s['format:check'] && !hasStep(s.verify, 'format:check')) {
      s.verify = insertStep(s.verify, { pm, script: 'format:check', before: 'lint' });
      notes.push('verify 에 format:check 추가 (기존 스텝 보존)');
    }

    if (!pkg.engines?.node) {
      pkg.engines = { ...(pkg.engines || {}), node: `>=${tc.node}` };
      notes.push(`engines.node 고정 (>=${tc.node})`);
    }
    // '지금 쓰는 매니저'를 고정한다. 매니저를 바꾸는 것은 L4 가 할 일이 아니다 (별도 작업).
    if (!pkg.packageManager && repo.packageManager !== 'none') {
      const pin = (et.packageManagers || {})[repo.packageManager];
      if (pin) { pkg.packageManager = pin; notes.push(`packageManager 고정 (${pin})`); }
    }
  }

  if (level >= 3) {
    const fixed = [];
    for (const k of ['lint', 'lint:fix']) {
      if (s[k] && /--ext\b/.test(s[k])) { s[k] = s[k].replace(/\s*--ext\s+\S+/g, ''); fixed.push(k); }
    }
    if (fixed.length) notes.push(`${fixed.join(', ')}에서 --ext 제거 (ESLint 9에서 삭제된 옵션)`);

    // L2 가 ESLint 설정이 없어 lint 없이 만든 verify 를, L3가 설정을 넣는 김에 lint 포함으로 바꾼다.
    // 하네스가 만든 그 문자열 그대로일 때만 — 사람이 고친 verify 는 건드리지 않는다.
    if ('lint' in s && (hasEslintConfig(repo) || harnessShipsEslint(repo))
        && s.verify === verifyChain(pm, s, false) && s.verify !== verifyChain(pm, s, true)) {
      s.verify = verifyChain(pm, s, true);
      notes.push('verify 에 lint 추가 (L3가 ESLint 설정을 넣으므로)');
    }

    const lt = toolchain().lintToolchain || { add: {}, remove: [] };
    const dev = pkg.devDependencies || (pkg.devDependencies = {});
    const changed = [], kept = [];
    for (const [name, ver] of Object.entries(lt.add)) {
      if (dev[name] === ver) continue;
      if (dev[name] && aheadOrEqual(dev[name], ver)) { kept.push(name); continue; }   // 이미 표준 이상
      changed.push(`${name}@${ver}`);
      dev[name] = ver;
    }
    const removed = [];
    for (const name of lt.remove) if (name in dev) { delete dev[name]; removed.push(name); }
    pkg.devDependencies = Object.fromEntries(Object.entries(dev).sort(([a], [b]) => a.localeCompare(b)));
    if (changed.length) notes.push(`린트 의존성 ${changed.length}개 갱신`);
    if (kept.length) notes.push(`${kept.length}개는 이미 표준 이상이라 유지`);
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
    profile: profileOf(repo),
    addons: repo.detectedAddons,
    level: targetLevel,
    release: repo.config?.release ?? false,
    // 바깥 층 선언은 사람이 적는 값이라 그대로 보존한다 (없으면 키 자체를 만들지 않는다)
    ...(Array.isArray(repo.config?.layers) ? { layers: repo.config.layers } : {}),
  };
  for (const l of resolveLayers(repo)) {
    if (!l.ok) warnings.push(`바깥 층 '${l.name}'을(를) 읽지 못했습니다 — ${l.problem}`);
  }
  acts.push(action(repo, 'kmjharness.json', JSON.stringify(cfg, null, 2) + '\n', 'update', '핸드셰이크 선언'));

  // L1 — 에이전트 컨텍스트 + 공통 파일
  if (targetLevel >= 1) {
    const userSection = existingUserSection(repo);
    const claudeExisting = read(path.join(repo.dir, 'CLAUDE.md'));
    const migrating = Boolean(claudeExisting && claudeExisting.trim() !== '@AGENTS.md' && !read(path.join(repo.dir, 'AGENTS.md')));

    // 'block': 마커 안쪽만 해시한다. 바깥(사용자 영역)은 자유롭게 바뀌어야 하므로.
    acts.push(action(repo, 'AGENTS.md', buildAgentsMd(repo, userSection), 'update',
      migrating ? '기존 CLAUDE.md 내용을 사용자 영역으로 이관' : '관리 블록만 갱신, 사용자 영역 보존', 'block'));
    acts.push(action(repo, 'CLAUDE.md', '@AGENTS.md\n', 'update',
      migrating ? '내용은 AGENTS.md로 옮기고 import 한 줄만 남김' : 'Claude Code 호환용 import'));
    acts.push(action(repo, '.editorconfig', tpl('profiles', 'base', 'files', '.editorconfig'), 'update', '공통 에디터 설정', true));

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

    // 레포마다 뺄 것이 달라 '없을 때만' 만든다. 생긴 뒤에는 각자 영역이고,
    // 빌드 산출물이 빠지면 doctor 가 알려준다 (빌드 뒤 format:check 가 실패하므로).
    const ignoreRel = '.prettierignore';
    if (!read(path.join(repo.dir, ignoreRel))) {
      acts.push(action(repo, ignoreRel, tpl('profiles', 'base', 'files', 'prettierignore'), 'create',
        '포맷에서 뺄 것 — 빌드 산출물·락파일·관리 파일'));
    }
  }

  // L3 — ESLint 9 flat config
  if (targetLevel >= 3) {
    const shared = profileFile(profileOf(repo), 'eslint.config.js');
    if (!shared) {
      warnings.push(`${profileOf(repo)} 프로파일에는 아직 공용 ESLint 설정이 없습니다.`);
    } else {
      acts.push(action(repo, '.kmjharness/eslint.config.js', shared, 'update', '공용 flat config', true));

      const rootRel = 'eslint.config.js';
      if (!read(path.join(repo.dir, rootRel))) {
        acts.push(action(repo, rootRel, profileFile(profileOf(repo), 'eslint.root.js'), 'create',
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

  // L4 — 강제. 설정을 '깔아둔' 상태에서 '지켜지는' 상태로 넘어가는 단계다.
  if (targetLevel >= 4) {
    const pm = pmOf(repo);
    const exec = pm === 'pnpm' ? 'pnpm exec' : pm === 'yarn' ? 'yarn' : 'npx';
    const lintBlock = hasEslintConfig(repo)
      ? (tpl('profiles', 'base', 'files', 'lefthook.lint.yml') || '').replaceAll('{{EXEC}}', exec).trimEnd()
      : '    # (이 레포에는 ESLint 설정이 없어 lint 훅을 넣지 않았습니다)';

    const lefthook = (tpl('profiles', 'base', 'files', 'lefthook.yml') || '')
      .replaceAll('{{EXEC}}', exec)
      .replaceAll('{{LINT_BLOCK}}', lintBlock)
      .replaceAll('{{VERIFY_CMD}}', pm === 'npm' || pm === 'none' ? 'npm run verify' : `${pm} verify`);
    acts.push(action(repo, 'lefthook.yml', lefthook, 'update',
      'pre-commit: 변경 파일만 포맷·린트 · pre-push: verify 전체', true));

    acts.push(action(repo, '.nvmrc', `${toolchain().node}\n`, 'update', 'Node 버전 고정', true));

    // 포맷 커밋을 blame 에서 건너뛰게 하는 목록. 내용은 레포마다 다르므로 없을 때만 만든다.
    const blameRel = '.git-blame-ignore-revs';
    if (!read(path.join(repo.dir, blameRel))) {
      acts.push(action(repo, blameRel, tpl('profiles', 'base', 'files', 'git-blame-ignore-revs'), 'create',
        '전체 포맷 커밋을 git blame 에서 건너뛰기 위한 목록'));
    }

    warnings.push('적용 후 의존성을 설치하면 lefthook 이 .git/hooks 에 자리를 잡습니다 (prepare 스크립트).');
    warnings.push('훅은 --no-verify 로 건너뛸 수 있습니다. 정말로 막으려면 GitHub branch protection 이 필요합니다 (docs/branch-protection.md).');
    warnings.push('포맷을 아직 한 번도 적용하지 않았다면 verify 가 format:check 에서 실패합니다 — [포맷 적용] 을 먼저 돌리고, 그 결과는 단독 커밋으로 남기세요.');
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
