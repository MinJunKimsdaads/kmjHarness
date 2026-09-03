// 로컬 전용 API 서버. 127.0.0.1에만 바인딩한다.
// UI와 CLI가 같은 core를 호출한다 — 여기에는 로직이 없고 배선만 있다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { harnessRoot, workspaceRoot } from '../core/paths.js';
import { scanWorkspace } from '../core/scan.js';
import { diagnose } from '../core/doctor.js';
import { planLevel } from '../core/plan.js';
import { applyPlan } from '../core/apply.js';
import { LEVELS } from '../core/levels.js';
import { startRun, getJob, jobView, allJobs } from '../core/run.js';
import { toolchainRows } from '../core/versions.js';
import { staleDeps } from '../core/deps.js';
import { nextSteps } from '../core/steps.js';
import { toolchain } from '../core/paths.js';

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

const findRepo = (name) => scanWorkspace().find((r) => r.name === name);

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(harnessRoot, 'ui', 'index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(html);
  }

  if (url.pathname === '/api/state') {
    const repos = scanWorkspace().map((r) => {
      const { pkg, files, ...rest } = r;
      const deps = staleDeps(r);
      // 현재 레벨 기준으로 아직 적용되지 않은 변경 (하네스가 업데이트된 경우 생긴다)
      const pending = r.level == null ? 0 : planLevel(r, r.level).changed;
      return { ...rest, scripts: pkg?.scripts ?? null, diagnosis: diagnose(r), toolchain: toolchainRows(r),
               deps, pendingSync: pending, steps: nextSteps(r, deps, getJob(r.name), pending) };
    });
    // toolchain.json 을 그대로 내려보낸다 — 안내 문서의 '표준 버전' 표가 여기서 만들어진다.
    return json(res, 200, { workspaceRoot, levels: LEVELS, repos, runs: allJobs(), toolchain: toolchain() });
  }

  // verify 실행 — 오래 걸리므로 시작만 하고 즉시 응답한다.
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
    const plan = planLevel(repo, Number(level));
    return json(res, 200, applyPlan(repo, plan));
  }

  json(res, 404, { error: 'not found' });
}

export function startServer(port = 4321) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => json(res, 500, { error: String(e?.stack || e) }));
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') { console.log(`포트 ${port} 사용 중 — ${port + 1}로 재시도`); startServer(port + 1); }
    else throw e;
  });
  server.listen(port, '127.0.0.1', () => {
    const started = new Date().toLocaleTimeString('ko-KR');
    console.log(`\n  kmjHarness 대시보드\n  http://127.0.0.1:${port}\n\n  워크스페이스: ${workspaceRoot}\n  코드 로드 시각: ${started}\n\n  core/ 를 수정하면 재시작이 필요합니다 (npm run dashboard:watch 를 쓰면 자동)\n  종료: Ctrl+C\n`);
  });
  return server;
}
