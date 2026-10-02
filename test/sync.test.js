// GitHub(추적 브랜치)과의 차이: ↑ push 안 된 커밋 · ↓ 뒤처진 커밋. 진짜 git 과 로컬 bare 원격으로 확인한다.
import { ws, write, git } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanRepo, scanRepoAsync } from '../core/scan.js';
import { diagnose } from '../core/doctor.js';
import { nowTask, orderSteps, otherIssues } from '../core/steps.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'index.js');
const noDeps = { stale: [], missing: [], needsInstall: false };

// .remotes 는 점으로 시작해 레포로 잡히지 않는다
git('', 'init', '-q', '--bare', '.remotes/origin.git');
write('seed/a.txt', '0\n');
git('seed', 'init', '-q'); git('seed', 'add', '-A'); git('seed', 'commit', '-qm', 'c0');
git('seed', 'remote', 'add', 'origin', '../.remotes/origin.git');
git('seed', 'push', '-q', '-u', 'origin', 'main');

git('', 'clone', '-q', '.remotes/origin.git', 'up');         // ↑1
git('', 'clone', '-q', '.remotes/origin.git', 'down');       // ↓2 (+ 미커밋)
git('', 'clone', '-q', '.remotes/origin.git', 'same');       // 같음
git('', 'clone', '-q', '.remotes/origin.git', 'detached');   // 분리된 HEAD
write('up/b.txt', '1\n'); git('up', 'add', '-A'); git('up', 'commit', '-qm', 'local');
for (const i of [1, 2]) { write(`seed/a.txt`, `${i}\n`); git('seed', 'commit', '-qam', `c${i}`); }
git('seed', 'push', '-q');
git('down', 'fetch', '-q');                                  // 숫자는 마지막 fetch 기준
write('down/a.txt', 'local edit\n');
git('detached', 'checkout', '-q', '--detach');
write('noup/a.txt', '0\n'); git('noup', 'init', '-q'); git('noup', 'add', '-A'); git('noup', 'commit', '-qm', 'x');   // 원격 없음
write('plain/a.txt', 'x\n');                                 // git 아님

test('ahead/behind 와 추적 브랜치, 마지막 fetch 시각', () => {
  const up = scanRepo('up').git;
  assert.deepEqual([up.ahead, up.behind, up.upstream], [1, 0, 'origin/main']);
  const down = scanRepo('down').git;
  assert.deepEqual([down.ahead, down.behind], [0, 2]);
  assert.ok(Math.abs(Date.now() - down.lastFetch) < 60_000, '방금 fetch 함');
  assert.equal(down.dirty, 1);
  const same = scanRepo('same').git;
  assert.deepEqual([same.ahead, same.behind], [0, 0]);
});

test('추적 브랜치 없음 · 분리된 HEAD · git 아님 → null', () => {
  for (const name of ['noup', 'detached', 'plain']) {
    const g = scanRepo(name).git;
    assert.deepEqual([g.ahead, g.behind, g.upstream], [null, null, null], name);
  }
});

test('비동기 스캔(대시보드 서버)도 같은 값', async () => {
  for (const name of ['up', 'down', 'same', 'noup', 'detached', 'plain']) assert.deepEqual(await scanRepoAsync(name), scanRepo(name), name);
});

test('nowTask: 뒤처지면 pull 먼저 (미커밋이 있으면 stash/커밋 안내), 버튼 없음', () => {
  const r = { ...scanRepo('down'), level: 3 };
  const t = nowTask(r, diagnose(r), noDeps);
  assert.deepEqual([t.kind, t.step, t.action], ['do', 'git', null]);
  assert.equal(t.text, 'GitHub보다 커밋 2개 뒤처짐 — 먼저 git pull');
  assert.match(t.why, /stash/);
  // 설치·병합·금지 의존성은 pull 보다 먼저
  assert.equal(nowTask(r, diagnose(r), { ...noDeps, needsInstall: true, missing: ['x'] }).action, 'install');
  assert.equal(nowTask({ ...r, git: { ...r.git, inMerge: true } }, null, noDeps).kind, 'block');
});

test('nowTask: push 안 된 커밋은 할 일이 없을 때만, 버튼 없음 (대시보드는 push 하지 않는다)', () => {
  const up = scanRepo('up');
  const top = { ...up, level: 3, handshake: { state: 'linked' } };
  const t = nowTask(top, { findings: [] }, noDeps);
  assert.deepEqual([t.kind, t.step, t.action], ['do', 'push', null]);
  assert.equal(t.text, 'push 안 된 커밋 1개 — git push');
  assert.match(t.why, /GitHub에는 아직 없습니다/);
  // 승급할 게 남아 있으면 그게 먼저
  assert.equal(nowTask({ ...top, level: 1 }, { findings: [] }, noDeps).action, 'promote');
  // 같으면 완료
  assert.equal(nowTask({ ...scanRepo('same'), level: 3, handshake: { state: 'linked' } }, { findings: [] }, noDeps).kind, 'done');
});

test('순서: GitHub 칸이 생기고, "지금" 칸은 nowTask 와 같다', () => {
  const at = (name, level = 3) => {
    const r = { ...scanRepo(name), level, handshake: { state: 'linked' } };
    const task = nowTask(r, { findings: [] }, noDeps);
    return { task, order: orderSteps(r, noDeps, task) };
  };
  const now = (o) => o.order.filter((s) => s.state === 'now').map((s) => s.id);
  const push = (o) => o.order.find((s) => s.id === 'push');
  let o = at('up');   assert.deepEqual(now(o), ['push']); assert.equal(push(o).label, 'push 필요 (↑1)');
  o = at('down');     assert.deepEqual(now(o), ['git']);  assert.match(o.order.find((s) => s.id === 'git').label, /pull 필요 \(↓2\)/);
  o = at('same');     assert.deepEqual(now(o), []);       assert.deepEqual([push(o).label, push(o).state], ['GitHub와 같음', 'done']);
  o = at('noup');     assert.equal(push(o).state, 'skip');
  assert.equal(at('plain').order.find((s) => s.id === 'push'), undefined);   // git 아님 → 칸 없음
});

test('doctor 는 info 로만 알리고, "+경고" 에는 세지 않는다', () => {
  const d = diagnose({ ...scanRepo('down'), level: 3 });
  const behind = d.findings.find((f) => f.id === 'behind');
  assert.equal(behind.severity, 'info');
  assert.match(behind.detail, /마지막 fetch .* 기준/);
  const up = diagnose({ ...scanRepo('up'), level: 3 });
  assert.equal(up.findings.find((f) => f.id === 'ahead').severity, 'info');
  assert.ok(!otherIssues(d).some((f) => ['behind', 'ahead'].includes(f.id)));
  assert.ok(!otherIssues({ findings: [{ id: 'ahead', severity: 'warn', title: 'x' }] }).length);
});

test('kmjh list 는 브랜치 옆에 ↑N · ↓N 을 보여 준다', () => {
  const out = spawnSync(process.execPath, [cli, 'list'], { env: process.env, encoding: 'utf8' }).stdout;
  const line = (n) => out.split('\n').find((l) => l.startsWith(n + ' '));
  assert.match(line('up'), /main ↑1/);
  assert.match(line('down'), /main ±1 ↓2/);
  assert.match(line('down'), /GitHub보다 커밋 2개 뒤처짐/);
  assert.ok(!/[↑↓]/.test(line('same')));
  assert.match(out, /마지막 fetch 기준/);
});
