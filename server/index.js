// 로컬 전용 API 서버. 127.0.0.1에만 바인딩한다.
// UI와 CLI가 같은 core를 호출한다 — 여기에는 로직이 없고 배선만 있다.
//
// 첫 화면이 빨리 뜨도록 API를 둘로 나눈다.
//   GET /api/repos       목록만 (파일 몇 개 읽기). git · 진단 · 의존성 검사 없음 → 즉시 응답
//   GET /api/repo?name=  레포 하나의 전부 (git 상태 · 진단 · 의존성 · 지금 할 일). UI가 몇 개씩 나눠 부른다
//                        git 은 비동기로 불러 여러 상세 요청이 동시에 진행되고, 그동안에도 목록은 바로 응답한다
//   GET /api/meta        레벨 정의 · 표준 버전 (설명서 탭과 레벨 카드용)
//
// 다른 웹 페이지가 브라우저를 통해 이 서버에 요청하는 것(CSRF · DNS 리바인딩)을 막는다.
//   - Host 는 127.0.0.1:<포트> 또는 localhost:<포트> 만
//   - POST 는 content-type: application/json 만 (단순 폼·no-cors 요청은 이 헤더를 못 붙인다)
//   - Origin 헤더가 있으면 이 서버 자신이어야 한다
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { harnessRoot, workspaceRoot, toolchain } from '../core/paths.js';
import { scanWorkspace, scanRepoAsync, quickScanWorkspace, listRepoNames } from '../core/scan.js';
import { diagnose } from '../core/doctor.js';
import { planLevel } from '../core/plan.js';
import { applyPlan, applyBlocker } from '../core/apply.js';
import { LEVELS, levelById, checkLevel } from '../core/levels.js';
import { startRun, getJob, jobView, allJobs, TASKS } from '../core/run.js';
import { toolchainRows } from '../core/versions.js';
import { staleDeps } from '../core/deps.js';
import { nextSteps, nowTask, orderSteps, otherIssues } from '../core/steps.js';
import { harnessVersion, setExcluded } from '../core/registry.js';

const BODY_LIMIT = 64 * 1024;

const json = (res, code, body) => {
  if (res.headersSent) return;
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// 본문은 64KB 까지, JSON 객체만 받는다.
const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > BODY_LIMIT) { reject(new HttpError(413, '요청 본문이 너무 큽니다 (64KB 까지)')); req.resume(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (size > BODY_LIMIT) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { return reject(new HttpError(400, '본문이 올바른 JSON 이 아닙니다')); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(new HttpError(400, '본문은 JSON 객체여야 합니다'));
    resolve(body);
  });
  req.on('error', reject);
});

// 워크스페이스에 실제로 있는 폴더 이름만 받는다 ('../' 같은 경로가 끼어들 수 없게).
async function findRepo(name) {
  if (typeof name !== 'string' || !listRepoNames().includes(name)) throw new HttpError(404, '레포를 찾을 수 없습니다');
  return scanRepoAsync(name);
}

// 쓰기·실행 요청은 제외한 폴더에 하지 않는다
function refuseExcluded(repo) {
  if (repo.excluded) throw new HttpError(409, `'${repo.name}'은(는) 제외한 폴더입니다. 먼저 [다시 넣기] 하세요.`);
}

function levelOf(body) {
  const c = checkLevel(body.level);
  if (!c.ok) throw new HttpError(400, c.error);
  return c.level;
}

// 현재 레벨 기준으로 아직 적용되지 않은 변경 수 (하네스가 업데이트된 경우 생긴다)
const pendingOf = (r) => (r.level == null || !levelById(r.level).implemented ? 0 : planLevel(r, r.level).changed);

function jobSummary(job) {
  if (!job) return null;
  const { lines, nextIndex, totalLines, ...rest } = jobView(job);
  return rest;
}

// 레포 하나의 상세. /api/state 의 한 줄과 같은 모양에 nowTask · order · job 을 더한 것.
function repoDetail(r) {
  const { pkg, files, ...rest } = r;
  const deps = staleDeps(r);
  const pending = pendingOf(r);
  const diagnosis = diagnose(r);
  const job = getJob(r.name);
  const task = nowTask(r, diagnosis, deps, { pendingSync: pending, job });
  return {
    ...rest, scripts: pkg?.scripts ?? null, hasPackageJson: Boolean(pkg),
    diagnosis, toolchain: toolchainRows(r), deps, pendingSync: pending,
    steps: nextSteps(r, deps, job, pending),
    nowTask: task,
    otherIssues: otherIssues(diagnosis),
    order: orderSteps(r, deps, task, { pendingSync: pending, job }),
    job: jobSummary(job),
  };
}

// 요청 출처 검사. 통과하면 null, 아니면 [상태, 메시지].
function guard(req, port) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(String(req.headers.host || '').toLowerCase())) return [403, '허용되지 않은 Host 입니다'];
  const origin = req.headers.origin;
  if (origin !== undefined && !hosts.some((h) => origin.toLowerCase() === `http://${h}`)) return [403, '허용되지 않은 Origin 입니다'];
  if (req.method === 'POST') {
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return [415, 'content-type 은 application/json 이어야 합니다'];
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    return [405, '허용되지 않은 메서드입니다'];
  }
  return null;
}

async function handle(req, res, port) {
  const url = new URL(req.url, 'http://localhost');
  const blocked = guard(req, port);
  if (blocked) return json(res, blocked[0], { error: blocked[1] });

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
    return json(res, 200, repoDetail(await findRepo(url.searchParams.get('name'))));
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
    if (typeof name !== 'string' || typeof excluded !== 'boolean') throw new HttpError(400, 'name 과 excluded(true/false)가 필요합니다');
    // 다시 넣기는 폴더가 사라진 이름도 정리할 수 있게 허용한다
    if (excluded && !listRepoNames().includes(name)) throw new HttpError(404, '레포를 찾을 수 없습니다');
    return json(res, 200, { name, excluded, exclude: setExcluded(name, excluded) });
  }

  // install / verify 실행 — 오래 걸리므로 시작만 하고 즉시 응답한다.
  if (url.pathname === '/api/run' && req.method === 'POST') {
    const { repo: name, script = 'verify' } = await readBody(req);
    if (!Object.hasOwn(TASKS, script)) throw new HttpError(400, `실행할 수 있는 것은 ${Object.keys(TASKS).join(' · ')} 뿐입니다`);
    const repo = await findRepo(name);
    refuseExcluded(repo);
    return json(res, 200, jobView(startRun(repo, script)));
  }

  // 진행 중인 로그를 이어받는다. since 이후의 줄만 돌려준다.
  if (url.pathname === '/api/run') {
    const job = getJob(url.searchParams.get('repo'));
    if (!job) return json(res, 200, null);
    return json(res, 200, jobView(job, Number(url.searchParams.get('since') || 0)));
  }

  if (url.pathname === '/api/plan' && req.method === 'POST') {
    const body = await readBody(req);
    const level = levelOf(body);
    const repo = await findRepo(body.repo);
    refuseExcluded(repo);
    return json(res, 200, planLevel(repo, level));
  }

  if (url.pathname === '/api/apply' && req.method === 'POST') {
    const body = await readBody(req);
    const level = levelOf(body);
    const repo = await findRepo(body.repo);
    refuseExcluded(repo);
    // 병합이 끝나지 않은 레포에는 쓰지 않는다 (core/apply.js 도 같은 판단으로 거부한다)
    const why = applyBlocker(repo);
    if (why) throw new HttpError(409, why);
    return json(res, 200, applyPlan(repo, planLevel(repo, level)));
  }

  json(res, 404, { error: 'not found' });
}

// port 0 이면 OS가 빈 포트를 고른다 (테스트용). 실제 포트는 server.address().port.
// 반환한 server 로 테스트가 close() 할 수 있다.
export function startServer(port = 4321, { quiet = false } = {}) {
  const server = http.createServer((req, res) => {
    handle(req, res, server.address().port).catch((e) => {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      if (e?.code === 'APPLY_BLOCKED') return json(res, 409, { error: e.message });
      // 내부 오류의 스택은 터미널에만 남기고, 브라우저에는 메시지만 보낸다
      console.error(e);
      json(res, 500, { error: `서버 오류 — ${e?.message || e}` });
    });
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
