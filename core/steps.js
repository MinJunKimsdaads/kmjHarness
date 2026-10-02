// "지금 뭘 눌러야 하는가"를 계산한다. 대시보드가 순서를 알려주지 못해 헤매던 문제를 없애기 위한 것.
//
// 순서 규칙:
//   1. 의존성이 어긋나 있으면 무조건 install 먼저 (안 하면 verify가 무의미하게 실패한다)
//   2. 그 다음 verify — 지금 상태가 실제로 통과하는지 확인
//   3. 통과했으면 다음 레벨로 승급
import fs from 'node:fs';
import path from 'node:path';
import { levelById, LEVELS, TOP_LEVEL } from './levels.js';
import { harnessVersion } from './registry.js';
import { hasEslintConfig, harnessShipsEslint, lintUsesEslint } from './eslintcfg.js';

const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const changedAt = (repo) => (repo.dir
  ? Math.max(mtime(path.join(repo.dir, 'package.json')), mtime(path.join(repo.dir, 'kmjharness.json')))
  : 0);

export function nextSteps(repo, deps, job, pendingSync = 0) {
  const steps = [];
  const cur = repo.level ?? -1;
  const next = LEVELS.find((l) => l.id === cur + 1);

  // 마지막 변경 시점보다 verify가 이전이면 그 결과는 낡은 것이다
  const verifyFresh = job && job.script === 'verify' && job.status === 'passed' && (job.endedAt ?? 0) > changedAt(repo);

  if (cur < 0) {
    steps.push({ id: 'promote', label: 'L0 편입', state: 'now', hint: '등록만 합니다. 파일은 건드리지 않습니다.' });
    return steps;
  }

  // 하네스가 새 기능을 갖게 되면 같은 레벨에서도 밀린 변경이 생긴다.
  // 승급과는 별개의 동작이므로 따로 안내한다.
  if (pendingSync > 0) {
    steps.push({ id: 'sync', label: '표준 재적용', state: 'now',
      hint: `${pendingSync}개 파일이 하네스 표준과 다릅니다` });
  }

  const installDone = !deps.needsInstall;
  const blockedBySync = pendingSync > 0;
  steps.push({
    id: 'install',
    label: '의존성 설치',
    state: installDone ? 'done' : blockedBySync ? 'wait' : 'now',
    hint: installDone ? '선언과 설치가 일치합니다' : `${[...deps.stale, ...deps.missing].length}개가 어긋나 있습니다`,
  });

  steps.push({
    id: 'verify',
    label: 'verify 실행',
    state: (!installDone || blockedBySync) ? 'wait' : verifyFresh ? 'done' : 'now',
    hint: verifyFresh ? `${(((job.endedAt ?? Date.now()) - job.startedAt) / 1000).toFixed(1)}초에 통과` :
          job && job.script === 'verify' && job.status === 'failed' ? '지난 실행이 실패했습니다' :
          job && job.endedAt && job.endedAt <= changedAt(repo) ? '마지막 실행 이후 파일이 바뀌었습니다' : '아직 확인하지 않았습니다',
  });

  if (next) {
    steps.push({
      id: 'promote',
      label: next.implemented ? `${next.name} 승급` : `${next.name} (준비 중)`,
      state: !next.implemented ? 'blocked' : (installDone && verifyFresh && !blockedBySync) ? 'now' : 'wait',
      hint: !next.implemented ? '아직 구현되지 않았습니다' : next.summary,
    });
  } else {
    steps.push({ id: 'done', label: '최고 레벨 도달', state: 'done', hint: '' });
  }

  return steps;
}

// ── 지금 할 일 ───────────────────────────────────────────────
// 레포마다 "지금 할 일" 하나만 고른다. 대시보드 목록과 `kmjh list` 가 같은 답을 내도록 여기 둔다.
//
// 우선순위 (위에서 처음 걸리는 것 하나):
//   1. 머지 충돌         → block   사람이 직접 풀어야 한다. 하네스는 손대지 않는다.
//   2. 금지 의존성        → block   package.json 에서 직접 지워야 한다.
//   3. 의존성 어긋남      → do      install
//   4. L3 이상 + 미커밋   → do      먼저 커밋 (버튼 없음). L3부터는 린트·의존성이 바뀌어 섞이면 되돌리기 어렵다.
//   5. 하네스 버전 지연 · 밀린 표준 → do  현재 레벨 다시 적용 (sync)
//   6. 마지막 verify 가 (그 뒤로 파일이 바뀌지 않았는데) 실패 → do  고친 뒤 다시 verify
//      — 실행 기록은 대시보드 서버 메모리에만 있으므로 job 을 넘긴 경우에만 본다 (CLI 는 넘기지 않음)
//   7. 미편입            → next    L0 등록
//   8. 구현된 최고 레벨 미만 → next  한 칸 올리기 (구현 안 된 레벨은 절대 권하지 않는다)
//   9. 그 외             → done
//
// 반환: { kind: 'block'|'do'|'next'|'done', step, text, action: null|'install'|'sync'|'promote'|'verify', toLevel?, why? }
//   step: 아래 orderSteps 의 어느 칸이 '지금'인지 (git · banned · install · sync · verify · level · null)
const DIRTY_BLOCKS_FROM = 3;
const OP_KO = { merge: '병합', rebase: '리베이스', 'cherry-pick': '체리픽', revert: '되돌리기(revert)' };

const verifyFailedFresh = (repo, job) => Boolean(job && job.script === 'verify'
  && (job.status === 'failed' || job.status === 'error') && (job.endedAt ?? 0) > changedAt(repo));
const verifyPassedFresh = (repo, job) => Boolean(job && job.script === 'verify'
  && job.status === 'passed' && (job.endedAt ?? 0) > changedAt(repo));
const syncDue = (repo, pendingSync) => repo.level != null && (repo.handshake?.state === 'stale' || pendingSync > 0);

export function nowTask(repo, diagnosis = null, deps = null, { pendingSync = 0, job = null } = {}) {
  const findings = diagnosis?.findings || [];
  const has = (id) => findings.find((f) => f.id === id);
  const g = repo.git || {};
  const level = repo.level ?? null;

  if (g.inMerge || has('merge-conflict')) {
    const op = OP_KO[g.operation] ?? '병합';
    return { kind: 'block', step: 'git', action: null,
      text: g.conflicted ? `머지 충돌 ${g.conflicted}개 파일 해결하기` : `진행 중인 ${op} 마무리하기`,
      why: g.conflicted
        ? '병합이 끝나지 않은 레포에는 하네스를 적용하지 않습니다. 충돌을 해결해 커밋하거나 git merge --abort 하세요.'
        : `${op}이 아직 끝나지 않았습니다. 커밋(또는 --continue)하거나 --abort 한 뒤에 하네스를 적용할 수 있습니다.` };
  }
  const banned = has('banned-deps');
  if (banned) {
    return { kind: 'block', step: 'banned', action: null, text: `${banned.title} 지우기`,
      why: 'Node 내장 모듈 이름을 흉내 낸 가짜 패키지입니다. package.json 에서 직접 지워 주세요.' };
  }
  const needsInstall = deps ? deps.needsInstall : Boolean(has('deps-stale'));
  if (needsInstall) {
    const n = deps ? deps.stale.length + deps.missing.length : 0;
    return { kind: 'do', step: 'install', action: 'install', text: '의존성 설치',
      why: n ? `package.json 에 적힌 것과 설치된 것이 ${n}개 다릅니다. 이대로면 verify 가 실패합니다.`
             : 'package.json 에 적힌 것과 설치된 것이 다릅니다.' };
  }
  // GitHub(추적 브랜치)에 새 커밋이 있다 — 커밋·적용하기 전에 pull 부터 (마지막 fetch 기준)
  if (g.behind > 0) {
    return { kind: 'do', step: 'git', action: null, text: `GitHub보다 커밋 ${g.behind}개 뒤처짐 — 먼저 git pull`,
      why: '다른 곳에서 올린 커밋이 있습니다. 커밋하거나 하네스를 적용하기 전에 먼저 pull 해야 충돌을 피합니다.'
        + (g.dirty > 0 ? ` 커밋 안 된 변경이 ${g.dirty}건 있으니 먼저 커밋하거나 git stash 한 뒤 pull 하세요.` : '')
        + ' (숫자는 마지막 fetch 기준입니다)' };
  }
  if (level != null && level >= DIRTY_BLOCKS_FROM && g.dirty > 0) {
    return { kind: 'do', step: 'git', action: null, text: `미커밋 변경 ${g.dirty}건 커밋하기`,
      why: '하네스 작업과 섞이지 않게 먼저 커밋해 두세요.' };
  }
  if (syncDue(repo, pendingSync)) {
    const stale = repo.handshake?.state === 'stale';
    return { kind: 'do', step: 'sync', action: 'sync', toLevel: level,
      text: stale ? `표준 다시 적용 (하네스 ${repo.config?.harness ?? '?'} → ${harnessVersion()})`
                  : `표준 다시 적용 — ${pendingSync}개 파일이 표준과 다름`,
      why: `L${level} 을 다시 적용해 하네스의 새 표준을 반영합니다. 레벨은 그대로입니다.` };
  }
  if (verifyFailedFresh(repo, job)) {
    // verify 가 ESLint 를 부르는데 설정이 없고, 다음 레벨(L3)이 설정을 넣어 주는 경우 — 그 레벨을 권한다.
    // (L2 까지만 적용된 레포가 "verify 실패 고치기"에 갇히지 않게)
    const s = repo.pkg?.scripts || {};
    if (level != null && level < TOP_LEVEL && level + 1 >= 3 && /\blint\b/.test(s.verify || '')
        && lintUsesEslint(s.lint) && !hasEslintConfig(repo) && harnessShipsEslint(repo)) {
      return { kind: 'next', step: 'level', action: 'promote', toLevel: level + 1, text: `L${level + 1}로 올리기`,
        why: `verify 가 실패한 이유는 아마 ESLint 설정이 없어서입니다. L${level + 1}이 공용 ESLint 설정을 넣어 해결합니다.` };
    }
    return { kind: 'do', step: 'verify', action: 'verify', text: 'verify 실패 고치기',
      why: '마지막 verify 가 실패했습니다. 원인을 고친 뒤 다시 확인하세요. 통과해야 다음 레벨을 권합니다.' };
  }
  if (level == null) {
    return { kind: 'next', step: 'level', action: 'promote', toLevel: 0, text: 'L0 등록 — 파일을 건드리지 않음',
      why: levelById(0).short };
  }
  if (level < TOP_LEVEL) {
    return { kind: 'next', step: 'level', action: 'promote', toLevel: level + 1, text: `L${level + 1}로 올리기`,
      why: levelById(level + 1).short ?? levelById(level + 1).summary };
  }
  // 커밋은 됐지만 GitHub 에 없다. push 는 사용자가 자기 인증으로 한다 — 대시보드는 버튼을 주지 않는다.
  if (g.ahead > 0) {
    return { kind: 'do', step: 'push', action: null, text: `push 안 된 커밋 ${g.ahead}개 — git push`,
      why: '커밋은 됐지만 GitHub에는 아직 없습니다. 레포 폴더에서 git push 하세요.' };
  }
  return { kind: 'done', step: null, action: null, text: '할 일 없음' };
}

// ── 순서 ─────────────────────────────────────────────────────
// 대시보드 펼침의 '순서' 목록. nowTask 와 같은 데이터로 만들어, '지금(now)' 칸은 언제나 nowTask 가 고른 그 칸이다.
// 반환: [{ id, label, state: 'done'|'now'|'wait'|'skip' }]
export function orderSteps(repo, deps, task, { pendingSync = 0, job = null } = {}) {
  const g = repo.git || {};
  const level = repo.level ?? null;
  const hasPkg = Boolean(repo.pkg);
  const out = [];
  const add = (id, label, state) => out.push({ id, label, state: task?.step === id ? 'now' : state });

  if (g.inMerge) add('git', task?.step === 'git' ? task.text : '병합 마무리', 'wait');
  else if (g.behind > 0) add('git', `pull 필요 (↓${g.behind})${g.dirty > 0 ? ` — 미커밋 ${g.dirty}건은 먼저 커밋·stash` : ''}`, 'wait');
  else if (g.dirty > 0) {
    add('git', level != null && level >= DIRTY_BLOCKS_FROM ? `미커밋 변경 ${g.dirty}건 커밋` : `미커밋 변경 ${g.dirty}건 (적용 전에 커밋 권장)`, 'wait');
  } else add('git', '커밋 안 된 변경 없음', 'done');

  if (task?.step === 'banned') add('banned', task.text, 'now');

  if (!hasPkg) add('install', '의존성 설치 — package.json 없음', 'skip');
  else add('install', '의존성 설치', deps?.needsInstall ? 'wait' : 'done');

  if (syncDue(repo, pendingSync)) add('sync', `표준 다시 적용 (L${level})`, 'wait');

  if (!hasPkg) add('verify', 'verify — package.json 없음', 'skip');
  else if (!repo.pkg.scripts?.verify) add('verify', 'verify — L2에서 생김', 'skip');
  else add('verify', verifyFailedFresh(repo, job) ? 'verify 실패' : 'verify 통과', verifyPassedFresh(repo, job) ? 'done' : 'wait');

  if (level != null && level >= TOP_LEVEL) add('level', `최고 레벨 (L${TOP_LEVEL + 1} 준비 중)`, 'done');
  else add('level', level == null ? 'L0 등록' : `L${level + 1}로 올리기`, 'wait');

  // GitHub 과의 동기 상태 (추적 브랜치가 있을 때만 알 수 있다)
  if (repo.isGitRepo) {
    if (g.ahead == null) add('push', 'GitHub 추적 브랜치 없음', 'skip');
    else if (g.ahead > 0) add('push', `push 필요 (↑${g.ahead})`, 'wait');
    else if (g.behind > 0) add('push', 'GitHub와 맞추기 — pull 뒤', 'wait');
    else add('push', 'GitHub와 같음', 'done');
  }

  return out;
}

// "지금 할 일" 하나에 가려지는 다른 오류·경고. 현황표 한 줄에 "+경고 N" 으로 붙인다.
// nowTask 가 이미 다루는 것(병합·금지 의존성·설치·핸드셰이크)은 빼고 센다.
// ahead/behind 는 info 라 원래 세지 않지만, 혹시 등급이 바뀌어도 '+경고' 에 섞이지 않게 명시한다.
const COVERED = new Set(['merge-conflict', 'banned-deps', 'deps-stale', 'handshake', 'behind', 'ahead']);
export function otherIssues(diagnosis) {
  return (diagnosis?.findings || [])
    .filter((f) => (f.severity === 'error' || f.severity === 'warn') && !COVERED.has(f.id))
    .map((f) => ({ id: f.id, severity: f.severity, title: f.title }));
}
