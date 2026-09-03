// 진단 규칙. 쓰기 없음. 대시보드와 CLI가 공유하는 유일한 데이터 소스.
// 규칙마다 sinceLevel이 있어, 레포의 현재 레벨보다 높은 규칙은 '예고(info)'로만 표시된다.
import path from 'node:path';
import fs from 'node:fs';
import { toolchain, exists, readJson } from './paths.js';
import { hash } from './apply.js';
import { staleDeps } from './deps.js';


const REQUIRED_SCRIPTS = ['dev', 'build', 'lint', 'format', 'typecheck', 'test', 'verify'];
const TRACKED = ['react', 'vite', 'typescript', 'eslint', 'prettier', 'vitest', 'tailwindcss'];

const norm = (r) => String(r || '').replace(/^[\^~]/, '');
const major = (r) => parseInt(norm(r).split('.')[0], 10);

export function diagnose(repo) {
  const tc = toolchain();
  const f = [];
  const level = repo.level ?? -1;
  const add = (o) => f.push({ ...o, severity: (repo.level ?? -1) < o.sinceLevel ? 'info' : o.severity });

  // — 핸드셰이크
  if (repo.handshake.state === 'unmanaged') {
    f.push({ id: 'handshake', sinceLevel: 0, severity: 'warn', title: '미편입 레포',
      detail: 'kmjharness.json이 없습니다. 하네스가 관리하지 않는 상태입니다.', fix: 'L0으로 편입' });
  } else if (repo.handshake.state === 'orphan-repo') {
    f.push({ id: 'handshake', sinceLevel: 0, severity: 'info', title: '하네스 레지스트리에 없음',
      detail: 'workspace.json 은 머신마다 다르므로 커밋하지 않습니다. 클론 직후엔 비어 있는 게 정상입니다.',
      fix: 'kmjh scan 으로 자동 복구' });
  } else if (repo.handshake.state !== 'linked') {
    f.push({ id: 'handshake', sinceLevel: 0, severity: 'warn', title: `핸드셰이크 불일치 — ${repo.handshake.label}`,
      detail: '프로젝트와 하네스의 선언이 일치하지 않습니다.', fix: '재동기화' });
  }

  // — 관리 파일 drift (manifest의 해시와 현재 파일 비교)
  const manifest = readJson(path.join(repo.dir, '.kmjharness', 'manifest.json'));
  if (manifest?.files) {
    const drifted = Object.entries(manifest.files).filter(([rel, h]) => {
      try { return hash(fs.readFileSync(path.join(repo.dir, rel), 'utf8')) !== h; }
      catch { return true; }   // 파일이 사라진 것도 drift
    }).map(([rel]) => rel);
    if (drifted.length) {
      f.push({ id: 'drift', sinceLevel: 0, severity: 'warn', title: `관리 파일이 손으로 수정됨 — ${drifted.length}개`,
        detail: `${drifted.join(', ')} — kmjh가 관리하는 파일입니다. 다시 sync하면 표준 내용으로 되돌아갑니다.`,
        fix: '변경이 필요하면 kmjHarness의 profiles/ 를 고칠 것' });
    }
  }

  // — 프로파일
  if (repo.detectedProfile === 'unknown') {
    f.push({ id: 'profile', sinceLevel: 0, severity: 'warn', title: '프로파일 판별 불가',
      detail: 'package.json 지문으로 유형을 특정하지 못했습니다.', fix: '수동 지정 필요' });
  }

  // — 에이전트 컨텍스트
  if (!exists(path.join(repo.dir, 'AGENTS.md'))) {
    add({ id: 'agents-md', sinceLevel: 1, severity: 'error', title: 'AGENTS.md 없음',
      detail: '에이전트가 이 레포의 규칙을 모릅니다.', fix: 'L1에서 배포' });
  }
  if (!exists(path.join(repo.dir, '.editorconfig'))) {
    add({ id: 'editorconfig', sinceLevel: 1, severity: 'warn', title: '.editorconfig 없음', detail: '', fix: 'L1에서 배포' });
  }
  if (!exists(path.join(repo.dir, '.claude', 'settings.json'))) {
    add({ id: 'claude-settings', sinceLevel: 1, severity: 'warn', title: '.claude/settings.json 없음',
      detail: '../kmjHarness 참조 선언이 없습니다.', fix: 'L1에서 배포' });
  }

  // — 작업 상태
  const g = repo.git || {};
  if (g.inMerge) {
    f.push({ id: 'merge-conflict', sinceLevel: 0, severity: 'error',
      title: `머지 충돌 미해결 — ${g.conflicted}개 파일`,
      detail: '이 레포는 병합이 끝나지 않은 상태입니다. 충돌을 먼저 해결하기 전에는 하네스를 적용하면 안 됩니다.',
      fix: '충돌 해결 후 커밋 (또는 git merge --abort)' });
  }
  if (!g.inMerge && g.dirty > 0) {
    const parts = [];
    if (g.staged) parts.push(`staged ${g.staged}`);
    if (g.modified) parts.push(`수정 ${g.modified}`);
    if (g.untracked) parts.push(`untracked ${g.untracked}`);
    f.push({ id: 'dirty', sinceLevel: 0, severity: 'info', title: `미커밋 변경 ${g.dirty}건`,
      detail: `${parts.join(' · ')}${g.summary ? ' —' + g.summary : ''}. 적용 전에 커밋하거나 stash 하는 것을 권합니다.`, fix: '' });
  }
  if (g.eolNoise > 0) {
    f.push({ id: 'eol', sinceLevel: 0, severity: 'info', title: `줄바꿈 차이만 있는 파일 ${g.eolNoise}개`,
      detail: 'CRLF/LF 차이로 변경돼 보이는 파일입니다. 실제 내용 변화는 없습니다. .gitattributes로 줄바꿈을 고정하면 사라집니다.',
      fix: 'L1에서 .gitattributes 배포 검토' });
  }


  // — 선언한 의존성과 실제로 설치된 것이 어긋났는가
  if (repo.pkg) {
    const d = staleDeps(repo);
    if (d.needsInstall) {
      const parts = [];
      if (d.stale.length) parts.push(`버전 불일치: ${d.stale.slice(0, 4).join(', ')}${d.stale.length > 4 ? ` 외 ${d.stale.length - 4}개` : ''}`);
      if (d.missing.length) parts.push(`미설치: ${d.missing.slice(0, 4).join(', ')}${d.missing.length > 4 ? ` 외 ${d.missing.length - 4}개` : ''}`);
      f.push({ id: 'deps-stale', sinceLevel: 0, severity: 'error', title: '의존성 설치 필요',
        detail: `${parts.join(' · ')} — package.json은 바뀌었는데 node_modules가 따라오지 않았습니다.`,
        fix: 'install 실행' });
    }
  }

  if (!repo.pkg) return finalize(repo, f);

  // — 스크립트 계약
  const scripts = repo.pkg.scripts || {};
  const missing = REQUIRED_SCRIPTS.filter((s) => !(s in scripts));
  if (missing.length) {
    add({ id: 'scripts', sinceLevel: 2, severity: 'error', title: `스크립트 계약 미충족 (${missing.length}개 누락)`,
      detail: `누락: ${missing.join(', ')}`, fix: 'L2에서 병합' });
  }
  if (scripts['type-check'] && !scripts['typecheck']) {
    add({ id: 'script-naming', sinceLevel: 2, severity: 'warn', title: "스크립트 이름 불일치: 'type-check'",
      detail: "표준은 'typecheck' 입니다.", fix: 'L2에서 이름 통일' });
  }
  if (scripts.test && !/\brun\b|--run/.test(scripts.test)) {
    add({ id: 'test-watch', sinceLevel: 2, severity: 'warn', title: "'test'가 watch 모드",
      detail: `현재: ${scripts.test} — 표준은 1회 실행(vitest run)이고 watch는 test:watch 입니다.`, fix: 'L2에서 교정' });
  }

  // — Node / 패키지 매니저 고정
  if (!exists(path.join(repo.dir, '.nvmrc')) && !repo.pkg.engines?.node) {
    add({ id: 'node-pin', sinceLevel: 4, severity: 'error', title: 'Node 버전 고정 없음',
      detail: `.nvmrc도 engines.node도 없습니다. 표준: Node ${tc.node}`, fix: 'L4에서 고정' });
  }
  if (!repo.pkg.packageManager) {
    add({ id: 'pm-pin', sinceLevel: 4, severity: 'warn', title: 'packageManager 필드 없음',
      detail: `표준: ${tc.packageManager}`, fix: 'L4에서 고정' });
  }
  const wantPm = tc.packageManager.split('@')[0];
  if (repo.packageManager !== 'none' && repo.packageManager !== wantPm) {
    add({ id: 'pm-mismatch', sinceLevel: 4, severity: 'warn', title: `패키지 매니저 불일치 — ${repo.packageManager}`,
      detail: `표준은 ${wantPm} 입니다.`, fix: 'L4에서 전환' });
  }

  // — 툴체인 버전 스큐
  const deps = { ...(repo.pkg.dependencies || {}), ...(repo.pkg.devDependencies || {}) };
  for (const name of TRACKED) {
    if (!(name in deps)) continue;
    const want = tc.versions[name]; if (!want) continue;
    const a = major(deps[name]), b = major(want);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
      add({ id: `skew:${name}`, sinceLevel: 4, severity: a < b ? 'warn' : 'info',
        title: `${name} 메이저 불일치 — ${deps[name]}`, detail: `표준: ${want}`, fix: 'L4에서 상향' });
    }
  }

  // — 금지 의존성 (Node 내장 모듈 이름의 더미 패키지)
  const banned = (tc.bannedDependencies || []).filter((n) => n in (repo.pkg.dependencies || {}));
  if (banned.length) {
    f.push({ id: 'banned-deps', sinceLevel: 0, severity: 'error', title: `설치하면 안 되는 의존성 ${banned.length}개`,
      detail: `${banned.join(', ')} — Node 내장 모듈과 같은 이름의 더미 패키지입니다.`, fix: '제거 필요' });
  }

  // — 스타일링 표준
  const usesSass = 'sass' in deps || 'node-sass' in deps;
  if (usesSass) {
    add({ id: 'sass', sinceLevel: 3, severity: 'info', title: 'Sass 사용 중',
      detail: '표준은 Tailwind입니다. 기존 코드는 유지하고 신규 컴포넌트만 Tailwind로 작성하세요.', fix: 'src/styles/vendor/ 로 격리' });
  }

  // — CI (하네스 전용 워크플로. 레포의 ci.yml 은 건드리지 않는다)
  const wfPath = path.join(repo.dir, '.github', 'workflows', 'kmjh-verify.yml');
  if (!exists(wfPath)) {
    add({ id: 'kmjh-workflow', sinceLevel: 1, severity: 'warn', title: '하네스 검증 워크플로 없음',
      detail: 'push할 때 GitHub에서 verify가 돌지 않습니다.', fix: 'L1에서 배포 (경고 모드)' });
  } else {
    const wf = fs.readFileSync(wfPath, 'utf8');
    if (wf.includes('continue-on-error: true')) {
      add({ id: 'kmjh-workflow-warn', sinceLevel: 2, severity: 'warn', title: '검증 워크플로가 경고 모드',
        detail: 'CI가 실패해도 머지를 막지 않습니다.', fix: 'L2에서 차단 모드로 전환' });
    }
  }

  return finalize(repo, f);
}

function finalize(repo, findings) {
  const count = (s) => findings.filter((x) => x.severity === s).length;
  return {
    repo: repo.name,
    findings: findings.sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a.severity] - { error: 0, warn: 1, info: 2 }[b.severity])),
    summary: { error: count('error'), warn: count('warn'), info: count('info') },
    clean: count('error') === 0 && count('warn') === 0,
  };
}
