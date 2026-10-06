// 진단 규칙. 쓰기 없음. 대시보드와 CLI가 공유하는 유일한 데이터 소스.
// 규칙마다 sinceLevel이 있어, 레포의 현재 레벨보다 높은 규칙은 '예고(info)'로만 표시된다.
import path from 'node:path';
import fs from 'node:fs';
import { toolchain, exists, readJson } from './paths.js';
import { hash } from './apply.js';
import { managedBlock } from './markers.js';
import { hasStep } from './verifyscript.js';
import { staleDeps } from './deps.js';
import { resolveLayers } from './profiles.js';
import { oneShotTest, testRunner } from './testscript.js';
import { OP_LABEL } from './scan.js';
import { agoKo } from './time.js';


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
    // manifest 값은 두 가지 모양이다.
    //   "해시"                         → 파일 전체를 비교
    //   { hash, scope: 'block' }       → 마커 안쪽만 비교 (AGENTS.md)
    const drifted = Object.entries(manifest.files).filter(([rel, v]) => {
      const want = typeof v === 'string' ? v : v?.hash;
      const scope = typeof v === 'string' ? 'file' : v?.scope;
      let text;
      try { text = fs.readFileSync(path.join(repo.dir, rel), 'utf8'); }
      catch { return true; }                               // 파일이 사라진 것도 drift
      if (scope !== 'block') return hash(text) !== want;
      const blk = managedBlock(text);
      return blk === null || hash(blk) !== want;           // 블록을 통째로 지운 것도 drift
    }).map(([rel]) => rel);
    if (drifted.length) {
      f.push({ id: 'drift', sinceLevel: 0, severity: 'warn', title: `관리 파일이 손으로 수정됨 — ${drifted.length}개`,
        detail: `${drifted.join(', ')} — kmjh가 관리하는 파일입니다. 다시 sync하면 표준 내용으로 되돌아갑니다.`,
        fix: '변경이 필요하면 kmjHarness의 profiles/ 를 고칠 것' });
    }
  }

  // — 프로파일
  if ((repo.profile ?? repo.detectedProfile) === 'unknown') {
    f.push({ id: 'profile', sinceLevel: 0, severity: 'warn', title: '프로파일 판별 불가',
      detail: 'package.json 지문으로 유형을 특정하지 못했습니다.', fix: '수동 지정 필요' });
  } else if (repo.profile && repo.profile !== repo.detectedProfile && repo.detectedProfile !== 'unknown') {
    // 선언이 우선이므로 오류는 아니다. 의도한 것인지 사람이 한 번 보면 된다.
    f.push({ id: 'profile-declared', sinceLevel: 0, severity: 'info',
      title: `선언된 프로파일(${repo.profile})과 감지값(${repo.detectedProfile})이 다름`,
      detail: 'kmjharness.json 의 profile 을 따릅니다. 전환할 때가 되면 profile 값을 바꾸고 다시 sync 하세요.', fix: '' });
  }

  // — 바깥 층 (kmjharness.json 의 layers)
  for (const l of resolveLayers(repo)) {
    if (!l.ok) {
      f.push({ id: `layer:${l.name}`, sinceLevel: 0, severity: 'warn', title: `바깥 층 '${l.name}'을(를) 읽을 수 없음`,
        detail: `${l.from || '(경로 없음)'} — ${l.problem}`, fix: 'kmjharness.json 의 layers 경로 확인' });
    }
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
    if (g.conflicted > 0) {
      f.push({ id: 'merge-conflict', sinceLevel: 0, severity: 'error',
        title: `머지 충돌 미해결 — ${g.conflicted}개 파일`,
        detail: '이 레포는 병합이 끝나지 않은 상태입니다. 충돌을 먼저 해결하기 전에는 하네스를 적용하면 안 됩니다.',
        fix: '충돌 해결 후 커밋 (또는 git merge --abort)' });
    } else {
      // 충돌은 다 풀었지만 아직 커밋(또는 --continue)하지 않은 상태
      const op = OP_LABEL[g.operation] ?? '병합';
      f.push({ id: 'merge-conflict', sinceLevel: 0, severity: 'error',
        title: `${op}이 끝나지 않음 — 커밋 전`,
        detail: `${op} 중인 레포입니다. 마무리(커밋 또는 --continue)하거나 --abort 하기 전에는 하네스를 적용하면 안 됩니다.`,
        fix: g.operation === 'merge' || !g.operation ? 'git commit (또는 git merge --abort)' : `git ${g.operation} --continue (또는 --abort)` });
    }
  }
  if (!g.inMerge && g.dirty > 0) {
    const parts = [];
    if (g.staged) parts.push(`staged ${g.staged}`);
    if (g.modified) parts.push(`수정 ${g.modified}`);
    if (g.untracked) parts.push(`untracked ${g.untracked}`);
    f.push({ id: 'dirty', sinceLevel: 0, severity: 'info', title: `미커밋 변경 ${g.dirty}건`,
      detail: `${parts.join(' · ')}${g.summary ? ' —' + g.summary : ''}. 적용 전에 커밋하거나 stash 하는 것을 권합니다.`, fix: '' });
  }
  // GitHub(추적 브랜치)과의 차이 — 정보로만. fetch 는 하지 않으므로 마지막 fetch 시점 기준이다.
  const asOf = g.lastFetch ? `마지막 확인 ${agoKo(g.lastFetch)} 기준` : '확인 기록 없음 — 오래된 숫자일 수 있음';
  if (g.remoteStale && !(g.behind > 0) && !(g.ahead > 0)) {
    f.push({ id: 'remote-stale', sinceLevel: 0, severity: 'info', title: 'GitHub 정보가 오래됨',
      detail: `${g.upstream ?? '추적 브랜치'} 정보를 ${g.lastFetch ? agoKo(g.lastFetch) : '받은 기록이 없습니다'}${g.lastFetch ? '에 마지막으로 받았습니다' : ''}. 그 뒤 다른 곳에서 push 했다면 뒤처져 있을 수 있습니다.`,
      fix: 'git fetch' });
  }
  if (g.behind > 0) {
    f.push({ id: 'behind', sinceLevel: 0, severity: 'info', title: `GitHub보다 커밋 ${g.behind}개 뒤처짐`,
      detail: `${g.upstream ?? '추적 브랜치'}에 이 레포에 없는 커밋이 있습니다 (${asOf}).`, fix: 'git pull' });
  }
  if (g.ahead > 0) {
    f.push({ id: 'ahead', sinceLevel: 0, severity: 'info', title: `push 안 된 커밋 ${g.ahead}개`,
      detail: `${g.upstream ?? '추적 브랜치'}에 아직 없는 커밋입니다 (${asOf}).`, fix: 'git push' });
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
  // 아는 러너(vitest · jest)만 판단한다. node --test 같은 것은 원래 1회 실행이다.
  if (scripts.test && oneShotTest(scripts.test)) {
    add({ id: 'test-watch', sinceLevel: 2, severity: 'warn', title: "'test'가 watch 모드",
      detail: `현재: ${scripts.test} — 표준은 1회 실행(vitest run)이고 watch는 test:watch 입니다.`, fix: 'L2에서 교정' });
  }

  // react-scripts test 는 CI 환경변수가 없으면 watch 로 돈다. 하네스가 고치지는 않고 알리기만 한다 (info).
  if (testRunner(scripts.test) === 'react-scripts' && !/--watchAll=false|--watch=false/.test(scripts.test)) {
    f.push({ id: 'test-watch-cra', sinceLevel: 2, severity: 'info', title: "'test'가 watch 모드로 돌 수 있음 (react-scripts)",
      detail: `현재: ${scripts.test} — CI 환경변수가 없으면 watch 모드로 실행돼 verify 가 멈출 수 있습니다. 하네스는 이 스크립트를 고치지 않습니다.`,
      fix: '필요하면 "react-scripts test --watchAll=false" 로' });
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
  const deps = repo.deps ?? { ...(repo.pkg.dependencies || {}), ...(repo.pkg.devDependencies || {}) };
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

  // — CLAUDE.md 가 AGENTS.md 를 읽는가
  // 해시로 고정하지 않는 이유: Claude Code 는 import 아래에 도구 전용 지시를 덧붙이는 것을 허용한다.
  // 그래서 '정확히 같은가'가 아니라 '연결이 살아 있는가'만 본다.
  const claudeMd = path.join(repo.dir, 'CLAUDE.md');
  if (exists(path.join(repo.dir, 'AGENTS.md')) && exists(claudeMd)) {
    if (!/^\s*@AGENTS\.md\s*$/m.test(fs.readFileSync(claudeMd, 'utf8'))) {
      add({ id: 'claude-import', sinceLevel: 1, severity: 'warn', title: 'CLAUDE.md 가 AGENTS.md 를 읽지 않음',
        detail: 'Claude Code 는 AGENTS.md 를 직접 읽지 않습니다. @AGENTS.md 한 줄이 없으면 공통 규약이 전달되지 않습니다.',
        fix: 'CLAUDE.md 에 "@AGENTS.md" 줄 추가 (아래에 Claude 전용 지시를 덧붙이는 것은 괜찮습니다)' });
    }
  }

  // — 공용 린트 설정이 실제로 쓰이고 있는가
  // 레포에 이미 flat config가 있으면 하네스는 루트 파일을 덮어쓰지 않는다.
  // 그러면 벤더링된 공용 설정이 아무도 안 읽는 죽은 파일이 되므로 여기서 잡는다.
  const sharedLint = path.join(repo.dir, '.kmjharness', 'eslint.config.js');
  const rootLint = path.join(repo.dir, 'eslint.config.js');
  if (exists(sharedLint) && exists(rootLint)) {
    const root = fs.readFileSync(rootLint, 'utf8');
    if (!root.includes('.kmjharness/eslint.config.js')) {
      f.push({ id: 'lint-not-shared', sinceLevel: 3, severity: 'warn', title: '공용 린트 설정이 적용되지 않음',
        detail: '.kmjharness/eslint.config.js 를 배포했지만 루트 eslint.config.js 가 그것을 import 하지 않습니다. '
              + '지금은 이 레포만의 규칙으로 돌고 있습니다.',
        fix: "루트 eslint.config.js 를 `import harness from './.kmjharness/eslint.config.js'` 로 바꾸기" });
    }
  }

  // — L4 강제: 훅이 걸려 있는가, verify 가 포맷까지 보는가
  if (repo.pkg) {
    const lefthookRel = 'lefthook.yml';
    if (!exists(path.join(repo.dir, lefthookRel))) {
      add({ id: 'hooks-missing', sinceLevel: 4, severity: 'error', title: 'git 훅 설정 없음',
        detail: '커밋·푸시 순간에는 아무 검사도 돌지 않습니다. CI 에서야 문제를 알게 됩니다.',
        fix: 'L4에서 lefthook.yml 배포' });
    } else {
      // 설정 파일만 있고 설치를 안 하면 훅은 돌지 않는다 (prepare 는 install 때 실행된다)
      const hook = path.join(repo.dir, '.git', 'hooks', 'pre-commit');
      let installed = false;
      try { installed = /lefthook/i.test(fs.readFileSync(hook, 'utf8')); } catch { installed = false; }
      if (!installed) {
        add({ id: 'hooks-not-installed', sinceLevel: 4, severity: 'warn', title: '훅이 아직 설치되지 않음',
          detail: 'lefthook.yml 은 있지만 .git/hooks 에 자리를 잡지 않았습니다. 설정만 있고 실제로는 돌지 않는 상태입니다.',
          fix: '의존성 설치 (prepare 스크립트가 lefthook install 을 실행합니다)' });
      }
    }

    const v = repo.pkg.scripts?.verify;
    if (v && repo.pkg.scripts?.['format:check'] && !hasStep(v, 'format:check')) {
      add({ id: 'format-not-in-verify', sinceLevel: 4, severity: 'warn', title: 'verify 가 포맷을 보지 않음',
        detail: 'format:check 스크립트는 있지만 verify 가 부르지 않습니다. 포맷이 어긋나도 CI 가 통과합니다.',
        fix: 'L4에서 verify 에 끼워 넣음' });
    }
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
