import { write } from './helpers.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startServer } from '../server/index.js';
import { writeWorkspace, harnessVersion } from '../core/registry.js';

// 레포 셋: L3 로 편입된 레포 · 편입 안 된 npm 레포 · 데이터 폴더
write('adopted/package.json', { name: 'adopted', scripts: { verify: 'node -e 0' } });
write('adopted/pnpm-lock.yaml', '');
write('adopted/kmjharness.json', { harness: harnessVersion(), profile: 'node-service', level: 3 });
write('fresh/package.json', { name: 'fresh' });
write('fresh/package-lock.json', '{}');
write('data1/notes.txt', 'x');
writeWorkspace({ repos: { adopted: { profile: 'node-service', level: 3 } }, exclude: ['data1'] });

let server, base;
before(async () => {
  server = startServer(0, { quiet: true });
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
const post = async (p, b) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};

test('127.0.0.1 에만 바인딩한다', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

test('/api/repos 는 git·진단 없이 빠르게 목록과 제외 표시를 준다', async () => {
  const t0 = performance.now();
  const { status, body } = await get('/api/repos');
  const ms = performance.now() - t0;
  assert.equal(status, 200);
  assert.ok(ms < 1500, `${ms}ms`);
  const by = Object.fromEntries(body.repos.map((r) => [r.name, r]));
  assert.deepEqual(Object.keys(by).sort(), ['adopted', 'data1', 'fresh']);
  assert.equal(by.data1.excluded, true);
  assert.equal(by.fresh.excluded, false);
  assert.equal(by.adopted.level, 3);
  assert.equal(by.adopted.packageManager, 'pnpm');
  assert.equal(by.fresh.profile, 'node-service');
  for (const r of body.repos) {
    assert.ok(!('git' in r) && !('diagnosis' in r) && !('nowTask' in r), '목록에는 무거운 정보가 없다');
  }
});

test('/api/repo 는 한 레포의 진단과 nowTask 를 준다', async () => {
  const fresh = (await get('/api/repo?name=fresh')).body;
  assert.deepEqual([fresh.nowTask.kind, fresh.nowTask.action, fresh.nowTask.toLevel], ['next', 'promote', 0]);
  assert.ok(Array.isArray(fresh.diagnosis.findings));
  assert.ok(Array.isArray(fresh.toolchain));
  assert.equal(fresh.deps.needsInstall, false);
  assert.ok('git' in fresh);
  const adopted = (await get('/api/repo?name=adopted')).body;
  assert.equal(adopted.scripts.verify, 'node -e 0');
  assert.ok(['sync', null].includes(adopted.nowTask.action));   // L3 파일이 아직 없으니 다시 적용
  assert.equal((await get('/api/repo?name=nope')).status, 404);
  assert.equal((await get('/api/repo?name=' + encodeURIComponent('../kmjHarness'))).status, 404);
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
  assert.equal((await get('/api/repos')).body.repos.find((x) => x.name === 'fresh').excluded, false);
  assert.equal((await post('/api/exclude', { name: 'nope', excluded: true })).status, 404);
  assert.equal((await post('/api/exclude', { name: 'fresh' })).status, 400);
});

test('/api/state 는 하위 호환으로 남아 있다', async () => {
  const { status, body } = await get('/api/state');
  assert.equal(status, 200);
  assert.equal(body.repos.length, 3);
});
