// 로컬 전용 API 서버. 127.0.0.1에만 바인딩한다.
// UI와 CLI가 같은 core를 호출한다 — 여기에는 로직이 없고 배선만 있다.
//
// 첫 화면이 빨리 뜨도록 API를 둘로 나눈다.
//   GET /api/repos       목록만 (파일 몇 개 읽기). git · 진단 · 의존성 검사 없음 → 즉시 응답
//   GET /api/repo?name=  레포 하나의 전부 (git 상태 · 진단 · 의존성 · 지금 할 일). UI가 몇 개씩 나눠 부른다
//   GET /api/meta        레벨 정의 · 표준 버전 (설명서 탭과 레벨 카드용)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { harnessRoot, workspaceRoot, toolchain } from '../core/paths.js';
import { scanWorkspace, scanRepo, quickScanWorkspace, listRepoNames } from '../core/scan.js';
import { diagnose } from '../core/doctor.js';
import { planLevel } from '../core/plan.js';
import { applyPlan } from '../core/apply.js';
import { LEVELS, levelById } from '../core/levels.js';
import { startRun, getJob, jobView, allJobs } from '../core/run.js';
import { toolchainRows } from '../core/versions.js';
import { staleDeps } from '../core/deps.js';
import { nextSteps, nowTask } from '../core/steps.js';
import { harnessVersion, setExcluded } from '../core/registry.js';

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

// 워크스페이스에 실제로 있는 폴더 이름만 받는다 ('../' 같은 경로가 끼어들 수 없게).
const findRepo = (name) => (typeof name === 'string' && listRepoNames().includes(name) ? scanRepo(name) : null);

// 현재 레벨 기준으로 아직 적용되지 않은 변경 수 (하네스가 업데이트된 경우 생긴다)
const pendingOf = (r) => (r.level == null || !levelById(r.level).implemented ? 0 : planLevel(r, r.level).changed);

function jobSummary(job) {
  if (!job) return null;
  const { lines, nextIndex, totalLines, ...rest } = jobView(job);
  return rest;
}

// 레포 하나의 상세. /api/state 의 한 줄과 같은 모양에 nowTask · job 을 더한 것.
function repoDetail(r) {
  const { pkg, files, ...rest } = r;
  const deps = staleDeps(r);
  const pending = pendingOf(r);
  const diagnosis = diagnose(r);
  const job = getJob(r.name);
  return {
    ...rest, scripts: pkg?.scripts ?? null, hasPackageJson: Boolean(pkg),
    diagnosis, toolchain: toolchainRows(r), deps, pendingSync: pending,
    steps: nextSteps(r, deps, job, pending),
    nowTask: nowTask(r, diagnosis, deps, { pendingSync: pending, job }),
    job: jobSummary(job),
  };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(harnessRoot, 'ui', 'index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(html);
  }

  // 빠른 목록 — git · 진단 · 의존성 검사를 하지 않는다.
  if (url.pathname === '/api/repos') {
    return json(res, 200, { workspaceRoot, harnessVersion: harnessVersion(), repos: quickScanWorkspace(), runs: allJobs() });
  }

  // 레포 하나의 전부
  if (url.pathname === '/api/repo') {
    const r = findRepo(url.searchParams.get('name'));
    if (!r) return json(res, 404, { error: '레포를 찾을 수 없습니다' });
    return json(res, 200, repoDetail(r));
  }

  // toolchain.json 을 그대로 내려보낸다 — 설명서의 '표준 버전' 표가 여기서 만들어진다.
  if (url.pathname === '/api/meta') {
    return json(res, 200, { workspaceRoot, harnessVersion: harnessVersion(), levels: LEVELS, toolchain: toolchain() });
  }

  // 예전 대시보드용 (모든 레포를 한 번에 — 느리다). 하위 호환을 위해 남겨 둔다.
  if (url.pathname === '/api/state') {
    const repos = scanWorkspace().map((r) => {
      const { pkg, files, ...rest } = r;
      const deps = staleDeps(r);
      const pending = r.level == null ? 0 : planLevel(r, r.level).changed;
      return { ...rest, scripts: pkg?.scripts ?? null, diagnosis: diagnose(r), toolchain: toolchainRows(r),
               deps, pendingSync: pending, steps: nextSteps(r, deps, getJob(r.name), pending) };
    });
    return json(res, 200, { workspaceRoot, levels: LEVELS, repos, runs: allJobs(), toolchain: toolchain() });
  }

  // 이 머신에서 하네스를 적용하지 않을 폴더 지정/해제 (workspace.json 의 exclude)
  if (url.pathname === '/api/exclude' && req.method === 'POST') {
    const { name, excluded } = await readBody(req);
    if (typeof name !== 'string' || typeof excluded !== 'boolean') return json(res, 400, { error: 'name 과 excluded(true/false)가 필요합니다' });
    // 다시 넣기는 폴더가 사라진 이름도 정리할 수 있게 허용한다
    if (excluded && !listRepoNames().includes(name)) return json(res, 404, { error: '레포를 찾을 수 없습니다' });
    return json(res, 200, { name, excluded, exclude: setExcluded(name, excluded) });
  }

  // install / verify 실행 — 오래 걸리므로 시작만 하고 즉시 응답한다.
  if (url.pathname === '/api/run' && req.method === 'POST') {
    const { repo: name, script } = await readBody(req);
    const repo = findRepo(name);
    if (!repo) return json(res, 404, { error: '레포를 찾을 수 없습니다' });
    return json(res, 200, jobView(startRun(repo, script || 'verify')));
  }

  // 진행 중인 로그를 이어받는다. since 이후의 줄만 돌려준다.
  if (url.pathname === '/api/run') {
    const job = getJob(url.searchParams.get('repo'));
    if (!job) return json(res, 200, null);
    return json(res, 200, jobView(job, Number(url.searchParams.get('since') || 0)));
  }

  if (url.pathname === '/api/plan' && req.method === 'POST') {
    const { repo: name, level } = await readBody(req);
    const repo = findRepo(name);
    if (!repo) return json(res, 404, { error: '레포를 찾을 수 없습니다' });
    return json(res, 200, planLevel(repo, Number(level)));
  }

  if (url.pathname === '/api/apply' && req.method === 'POST') {
    const { repo: name, level } = await readBody(req);
    const repo = findRepo(name);
    if (!repo) return json(res, 404, { error: '레포를 찾을 수 없습니다' });
    // 병합이 끝나지 않은 레포에는 쓰지 않는다 (UI도 막지만 서버에서 한 번 더)
    if (repo.git?.inMerge) return json(res, 409, { error: '머지 충돌을 먼저 해결하세요. 병합 중인 레포에는 적용하지 않습니다.' });
    const plan = planLevel(repo, Number(level));
    if (plan.unavailable) return json(res, 400, { error: plan.reason });
    return json(res, 200, applyPlan(repo, plan));
  }

  json(res, 404, { error: 'not found' });
}

// port 0 이면 OS가 빈 포트를 고른다 (테스트용). 실제 포트는 server.address().port.
// 반환한 server 로 테스트가 close() 할 수 있다.
export function startServer(port = 4321, { quiet = false } = {}) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => json(res, 500, { error: String(e?.stack || e) }));
  });
  let tryPort = port;
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tryPort !== 0) {
      if (!quiet) console.log(`포트 ${tryPort} 사용 중 — ${tryPort + 1}로 재시도`);
      server.listen(++tryPort, '127.0.0.1');
    } else throw e;
  });
  server.on('listening', () => {
    if (quiet) return;
    const started = new Date().toLocaleTimeString('ko-KR');
    console.log(`\n  kmjHarness 대시보드\n  http://127.0.0.1:${server.address().port}\n\n  워크스페이스: ${workspaceRoot}\n  코드 로드 시각: ${started}\n\n  core/ 를 수정하면 재시작이 필요합니다 (npm run dashboard:watch 를 쓰면 자동)\n  종료: Ctrl+C\n`);
  });
  server.listen(tryPort, '127.0.0.1');
  return server;
}
