// "지금 뭘 눌러야 하는가"를 계산한다. 대시보드가 순서를 알려주지 못해 헤매던 문제를 없애기 위한 것.
//
// 순서 규칙:
//   1. 의존성이 어긋나 있으면 무조건 install 먼저 (안 하면 verify가 무의미하게 실패한다)
//   2. 그 다음 verify — 지금 상태가 실제로 통과하는지 확인
//   3. 통과했으면 다음 레벨로 승급
import fs from 'node:fs';
import path from 'node:path';
import { levelById, LEVELS } from './levels.js';

const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };

export function nextSteps(repo, deps, job, pendingSync = 0) {
  const steps = [];
  const cur = repo.level ?? -1;
  const next = LEVELS.find((l) => l.id === cur + 1);

  // 마지막 변경 시점보다 verify가 이전이면 그 결과는 낡은 것이다
  const changedAt = Math.max(mtime(path.join(repo.dir, 'package.json')), mtime(path.join(repo.dir, 'kmjharness.json')));
  const verifyFresh = job && job.script === 'verify' && job.status === 'passed' && (job.endedAt ?? 0) > changedAt;

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
          job && job.endedAt && job.endedAt <= changedAt ? '마지막 실행 이후 파일이 바뀌었습니다' : '아직 확인하지 않았습니다',
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
