// 상세(/api/repo)는 git 을 비동기로 불러 동시에 진행되고, 그동안 목록(/api/repos)은 git 없이 바로 응답한다.
// 느린 가짜 git 을 PATH 맨 앞에 두고 확인한다 (이 파일은 자기 프로세스에서만 돈다).
import { ws, write } from './helpers.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { startServer } from '../server/index.js';

const DELAY = 0.4;                                  // 가짜 git 한 번에 걸리는 초
const bin = path.join(ws, '.fakebin');              // 점으로 시작 → 레포로 잡히지 않는다
const log = path.join(ws, '.git-calls.log');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >> "${log}"\nsleep ${DELAY}\nexit 1\n`, { mode: 0o755 });
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
// 자기 .git 이 있어야 git 에 묻는다 (core/scan.js) — 빈 .git 폴더로 레포 흉내
for (const n of ['r1', 'r2', 'r3']) { write(`${n}/package.json`, { name: n }); fs.mkdirSync(path.join(ws, n, '.git')); }

let server, base;
before(async () => {
  server = startServer(0, { quiet: true });
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);

test('목록은 git 을 한 번도 부르지 않는다', { skip: process.platform === 'win32' }, async () => {
  const r = await fetch(`${base}/api/repos`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).repos.length, 3);
  assert.deepEqual(calls(), []);
});

test('상세 3개는 동시에 진행되고, 그동안 목록은 기다리지 않는다', { skip: process.platform === 'win32' }, async () => {
  const t0 = performance.now();
  const details = Promise.all(['r1', 'r2', 'r3'].map((n) => fetch(`${base}/api/repo?name=${n}`).then((r) => r.json())));
  await new Promise((r) => setTimeout(r, 100));       // 상세가 git 을 기다리는 중
  const t1 = performance.now();
  const list = await fetch(`${base}/api/repos`);
  const listMs = performance.now() - t1;
  const res = await details;
  const totalMs = performance.now() - t0;

  assert.equal(list.status, 200);
  assert.ok(res.every((d) => d.nowTask), '상세마다 nowTask');
  const perRepo = calls().length / 3;                  // 레포 하나에 git 을 몇 번 부르나
  assert.ok(perRepo >= 5, `git 호출 ${perRepo}번`);
  const serialMs = perRepo * 3 * DELAY * 1000;          // 하나씩 차례로 불렀다면 걸렸을 시간
  assert.ok(listMs < DELAY * 1000, `목록이 git 을 기다렸다: ${listMs.toFixed(0)}ms`);
  assert.ok(totalMs < serialMs / 3, `상세가 병렬로 돌지 않았다: ${totalMs.toFixed(0)}ms (직렬이면 ${serialMs}ms)`);
});
