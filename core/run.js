// 레포에서 verify를 실제로 실행한다. 대시보드가 "파일만 읽는 정적 분석"에서
// "정말 통과하는가"까지 볼 수 있게 하는 부분.
//
// 실행은 오래 걸리므로(2~3분) HTTP 요청을 붙잡지 않는다.
// 시작 → jobId 반환 → 클라이언트가 로그를 이어받아 폴링하는 구조.
import { spawn } from 'node:child_process';

const MAX_LINES = 3000;

// 색상·커서 제어 문자를 지운다. vitest·vite는 env만으로는 색을 끄지 않는 경우가 있다.
// eslint-disable-next-line no-control-regex
const ANSI = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const stripAnsi = (s) => String(s).replace(ANSI, '');
const jobs = new Map();   // repoName -> job

// install은 package.json 스크립트가 아니라 패키지 매니저 자체의 명령이다.
const cmdFor = (pm, task) => {
  if (task === 'install') {
    // pnpm은 락파일이 package.json과 어긋나면 install을 거부한다(--frozen-lockfile).
    // 하네스는 package.json을 바꾼 직후에 install을 부르므로, 락파일 갱신을 명시적으로 허용한다.
    if (pm === 'pnpm') return ['pnpm', ['install', '--no-frozen-lockfile']];
    return [pm === 'none' ? 'npm' : pm, ['install']];
  }
  return pm === 'npm' || pm === 'none' ? ['npm', ['run', task]] : [pm, [task]];
};
export const TASKS = { install: '의존성 설치', verify: '검증' };

// pnpm/npm이 실행하는 스크립트 이름을 로그에서 뽑아 현재 단계를 표시한다.
//   "> age-of-sail-rpg@1.0.0 lint C:\..." → "lint"
const STAGE_RE = /^>\s+\S+@\S+\s+(\S+)/;

export function getJob(repoName) {
  return jobs.get(repoName) ?? null;
}

export function startRun(repo, script = 'verify') {
  const existing = jobs.get(repo.name);
  if (existing?.status === 'running') return existing;

  if (script !== 'install' && !repo.pkg?.scripts?.[script]) {
    const job = {
      repo: repo.name, script, status: 'error', stage: null,
      startedAt: Date.now(), endedAt: Date.now(), exitCode: null,
      lines: [`'${script}' 스크립트가 없습니다. L2로 승급하면 생성됩니다.`],
    };
    jobs.set(repo.name, job);
    return job;
  }

  const pm = repo.packageManager === 'none' ? 'npm' : repo.packageManager;
  const [cmd, args] = cmdFor(pm, script);

  const job = {
    repo: repo.name, script, status: 'running', stage: null,
    startedAt: Date.now(), endedAt: null, exitCode: null,
    command: `${cmd} ${args.join(' ')}`,
    lines: [`$ ${cmd} ${args.join(' ')}`, `  (${repo.dir})`, ''],
  };
  jobs.set(repo.name, job);

  const push = (chunk) => {
    for (const raw of String(chunk).split(/\r?\n/)) {
      // \r 로 덮어쓰는 진행 표시(스피너 등)는 마지막 상태만 남긴다
      const last = raw.split('\r').pop();
      const line = stripAnsi(last).trimEnd();
      if (line === '' && job.lines[job.lines.length - 1] === '') continue;  // 빈 줄 연속 압축
      const m = STAGE_RE.exec(line);
      if (m) job.stage = m[1];
      job.lines.push(line);
    }
    if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
  };

  // Windows에서는 shell:true 여야 pnpm/npm(.cmd)이 해석된다.
  // 이때 cmd.exe를 거치므로 PowerShell 실행 정책에도 걸리지 않는다.
  let child;
  try {
    child = spawn(cmd, args, { cwd: repo.dir, shell: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb' } });
  } catch (e) {
    job.status = 'error'; job.endedAt = Date.now(); push(String(e.message));
    return job;
  }

  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('error', (e) => { push(`실행 실패: ${e.message}`); job.status = 'error'; job.endedAt = Date.now(); });
  child.on('close', (code) => {
    job.exitCode = code;
    job.endedAt = Date.now();
    if (job.status === 'running') job.status = code === 0 ? 'passed' : 'failed';
    push('');
    push(code === 0 ? `✓ ${script} 통과 (${((job.endedAt - job.startedAt) / 1000).toFixed(1)}초)`
                    : `✗ ${script} 실패 — exit ${code}${job.stage ? ` (${job.stage} 단계)` : ''}`);
  });

  job.child = child;
  return job;
}

// 클라이언트에 보낼 형태. child 프로세스 객체는 직렬화하면 안 된다.
export function jobView(job, since = 0) {
  if (!job) return null;
  const { child, lines, ...rest } = job;
  return {
    ...rest,
    durationMs: (job.endedAt ?? Date.now()) - job.startedAt,
    lines: lines.slice(since),
    nextIndex: lines.length,
    totalLines: lines.length,
  };
}

export const allJobs = () => Object.fromEntries([...jobs].map(([k, v]) => [k, {
  status: v.status, stage: v.stage, exitCode: v.exitCode,
  endedAt: v.endedAt, durationMs: (v.endedAt ?? Date.now()) - v.startedAt,
}]));
