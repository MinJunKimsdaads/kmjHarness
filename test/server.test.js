import { ws, write, mergeConflictRepo } from './helpers.js';
import { TOP_LEVEL } from '../core/levels.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { startServer } from '../server/index.js';
import { writeWorkspace, readWorkspace, harnessVersion } from '../core/registry.js';

// 레포 셋: L3 로 편입된 레포 · 편입 안 된 npm 레포 · 데이터 폴더(제외) · 병합 중인 레포
write('adopted/package.json', { name: 'adopted', scripts: { verify: 'node -e 0' } });
write('adopted/pnpm-lock.yaml', '');
write('adopted/kmjharness.json', { harness: harnessVersion(), profile: 'node-service', level: 3 });
write('fresh/package.json', { name: 'fresh' });
write('fresh/package-lock.json', '{}');
write('data1/notes.txt', 'x');
mergeConflictRepo('merging');
// 워크스페이스 바깥에 실제로 있는 폴더 — '../이름' 으로 빠져나가려는 시도용
const outside = path.basename(fs.mkdtempSync(path.join(path.dirname(ws), 'kmjh-outside-')));
process.on('exit', () => fs.rmSync(path.join(path.dirname(ws), outside), { recursive: true, force: true }));
writeWorkspace({ repos: { adopted: { profile: 'node-service', level: 3 } }, exclude: ['data1'] });

let server, port;
before(async () => {
  server = startServer(0, { quiet: true });
  await once(server, 'listening');
  port = server.address().port;
});
after(() => server.close());

// fetch 는 Host · Origin 을 마음대로 못 바꾸므로 http.request 로 보낸다
function raw(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path: p,
      headers: { host: `127.0.0.1:${port}`, ...(data !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => {
        let parsed = null; try { parsed = JSON.parse(b); } catch { parsed = b; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}
const get = (p, o) => raw('GET', p, o);
const post = (p, body, o = {}) => raw('POST', p, { body, ...o });

test('127.0.0.1 에만 바인딩한다', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

test('/api/repos 는 목록과 제외 표시만 준다 (git · 진단 없음)', async () => {
  const { status, body } = await get('/api/repos');
  assert.equal(status, 200);
  const by = Object.fromEntries(body.repos.map((r) => [r.name, r]));
  assert.deepEqual(Object.keys(by).sort(), ['adopted', 'data1', 'fresh', 'merging']);
  assert.equal(by.data1.excluded, true);
  assert.equal(by.fresh.excluded, false);
  assert.equal(by.adopted.level, 3);
  assert.equal(by.adopted.packageManager, 'pnpm');
  for (const r of body.repos) assert.ok(!('git' in r) && !('diagnosis' in r) && !('nowTask' in r));
});

test('/api/repo 는 진단 · nowTask · 순서를 주고, 순서의 "지금" 칸은 nowTask 와 같다', async () => {
  const fresh = (await get('/api/repo?name=fresh')).body;
  assert.deepEqual([fresh.nowTask.kind, fresh.nowTask.action, fresh.nowTask.toLevel], ['next', 'promote', 0]);
  assert.ok(Array.isArray(fresh.diagnosis.findings) && Array.isArray(fresh.toolchain));
  const adopted = (await get('/api/repo?name=adopted')).body;
  // L3 로 선언됐지만 L1~L3 파일이 없다 → 현재 레벨을 다시 적용
  assert.deepEqual([adopted.nowTask.kind, adopted.nowTask.action, adopted.nowTask.toLevel], ['do', 'sync', 3]);
  assert.ok(adopted.pendingSync > 0);
  for (const d of [fresh, adopted]) {
    const now = d.order.filter((o) => o.state === 'now');
    assert.equal(now.length, 1);
    assert.equal(now[0].id, d.nowTask.step);
  }
  assert.ok(adopted.order.some((o) => o.id === 'sync'));
  const merging = (await get('/api/repo?name=merging')).body;
  assert.equal(merging.nowTask.kind, 'block');
  assert.equal(merging.git.inMerge, true);
});

test('레포 이름으로 워크스페이스를 빠져나갈 수 없다', async () => {
  assert.equal((await get('/api/repo?name=nope')).status, 404);
  assert.ok(fs.existsSync(path.join(ws, '..', outside)));
  for (const name of [`../${outside}`, `..%2F${outside}`, '..', '.']) {
    assert.equal((await get('/api/repo?name=' + encodeURIComponent(name))).status, 404, name);
    assert.equal((await post('/api/plan', { repo: name, level: 0 })).status, 404, name);
  }
});

test('/api/meta 는 레벨 카드용 짧은 설명과 표준 버전을 준다', async () => {
  const { body } = await get('/api/meta');
  assert.equal(body.levels.length, 5);
  assert.ok(body.levels.every((l) => l.short && l.label));
  assert.ok(body.toolchain.node);
});

test('/api/exclude 로 넣고 뺄 수 있다', async () => {
  let r = await post('/api/exclude', { name: 'fresh', excluded: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.exclude, ['data1', 'fresh']);
  assert.equal((await get('/api/repos')).body.repos.find((x) => x.name === 'fresh').excluded, true);
  r = await post('/api/exclude', { name: 'fresh', excluded: false });
  assert.deepEqual(r.body.exclude, ['data1']);
  assert.deepEqual(readWorkspace().exclude, ['data1']);
  assert.equal((await post('/api/exclude', { name: 'nope', excluded: true })).status, 404);
  assert.equal((await post('/api/exclude', { name: 'fresh' })).status, 400);
});

test('제외한 폴더에는 계획 · 적용 · 실행을 하지 않는다', async () => {
  for (const [p, body] of [['/api/plan', { repo: 'data1', level: 0 }], ['/api/apply', { repo: 'data1', level: 0 }], ['/api/run', { repo: 'data1', script: 'install' }]]) {
    const r = await post(p, body);
    assert.equal(r.status, 409, p);
    assert.match(r.body.error, /다시 넣기/);
  }
  assert.ok(!fs.existsSync(path.join(ws, 'data1', 'kmjharness.json')));
});

test('병합 중인 레포에는 적용하지 않는다 (409)', async () => {
  const r = await post('/api/apply', { repo: 'merging', level: 0 });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /충돌/);
  assert.ok(!fs.existsSync(path.join(ws, 'merging', 'kmjharness.json')));
});

test('레벨은 정수 0..구현된 최고 레벨만', async () => {
  for (const level of [TOP_LEVEL + 1, -1, 1.5, '2a', null, undefined, '']) {
    for (const p of ['/api/plan', '/api/apply']) {
      const r = await post(p, { repo: 'fresh', level });
      assert.equal(r.status, 400, `${p} ${JSON.stringify(level)}`);
    }
  }
  assert.equal((await post('/api/plan', { repo: 'fresh', level: '1' })).status, 200);
  assert.ok(!fs.existsSync(path.join(ws, 'fresh', 'kmjharness.json')));
});

test('실행은 install · verify 만', async () => {
  assert.equal((await post('/api/run', { repo: 'fresh', script: 'build' })).status, 400);
  assert.equal((await post('/api/run', { repo: 'fresh', script: 'constructor' })).status, 400);
});

test('다른 사이트에서 온 요청(CSRF · DNS 리바인딩)은 거부한다', async () => {
  // no-cors 폼처럼 text/plain 으로 보내면 거부
  let r = await post('/api/apply', JSON.stringify({ repo: 'fresh', level: 0 }), { headers: { 'content-type': 'text/plain' } });
  assert.equal(r.status, 415);
  r = await raw('POST', '/api/apply', { body: JSON.stringify({ repo: 'fresh', level: 0 }), headers: { 'content-type': '' } });
  assert.equal(r.status, 415);
  // 다른 Origin
  r = await post('/api/apply', { repo: 'fresh', level: 0 }, { headers: { origin: 'http://evil.example' } });
  assert.equal(r.status, 403);
  r = await post('/api/exclude', { name: 'fresh', excluded: true }, { headers: { origin: `http://127.0.0.1:${port + 1}` } });
  assert.equal(r.status, 403);
  // DNS 리바인딩: 다른 Host 이름으로 들어온 요청
  r = await post('/api/apply', { repo: 'fresh', level: 0 }, { headers: { host: `evil.example:${port}` } });
  assert.equal(r.status, 403);
  assert.equal((await get('/api/repos', { headers: { host: `evil.example:${port}` } })).status, 403);
  assert.equal((await get('/api/repo?name=fresh', { headers: { host: 'localhost:1' } })).status, 403);
  assert.ok(!fs.existsSync(path.join(ws, 'fresh', 'kmjharness.json')), '거부된 요청은 아무것도 쓰지 않는다');
  assert.deepEqual(readWorkspace().exclude, ['data1']);
  // 자기 자신은 통과 (127.0.0.1 · localhost 둘 다)
  assert.equal((await get('/api/repos', { headers: { host: `localhost:${port}` } })).status, 200);
  assert.equal((await post('/api/plan', { repo: 'fresh', level: 0 }, { headers: { origin: `http://127.0.0.1:${port}` } })).status, 200);
  assert.equal((await post('/api/plan', { repo: 'fresh', level: 0 }, { headers: { origin: `http://localhost:${port}`, host: `localhost:${port}` } })).status, 200);
});

test('깨진 본문 · null · 너무 큰 본문은 400/413, 스택은 내보내지 않는다', async () => {
  for (const body of ['{"repo":', 'null', '[]', '42']) {
    const r = await post('/api/plan', body);
    assert.equal(r.status, 400, body);
    assert.ok(!/at .*\.js/.test(JSON.stringify(r.body)), '스택이 없어야 한다');
  }
  const big = await post('/api/exclude', { name: 'x'.repeat(70 * 1024), excluded: true }).catch((e) => ({ status: e.code }));
  assert.ok([413, 'ECONNRESET', 'EPIPE'].includes(big.status), String(big.status));
});

test('/api/state 는 하위 호환으로 남아 있다', async () => {
  const { status, body } = await get('/api/state');
  assert.equal(status, 200);
  assert.equal(body.repos.length, 4);
});
