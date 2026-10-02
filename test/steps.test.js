import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { nowTask } from '../core/steps.js';
import { harnessVersion } from '../core/registry.js';

// nowTask 가 보는 최소한의 모양만 만든다
const repo = (o = {}) => ({ name: 'r', level: null, git: {}, handshake: { state: 'linked' }, config: null, ...o });
const diag = (...ids) => ({ findings: ids.map((id) => ({ id, title: id === 'banned-deps' ? '설치하면 안 되는 의존성 2개' : id })) });
const deps = (n = 0) => ({ stale: [], missing: Array.from({ length: n }, (_, i) => `p${i}`), needsInstall: n > 0 });

test('머지 충돌이 무엇보다 먼저 — 버튼 없음', () => {
  const t = nowTask(repo({ level: 1, git: { inMerge: true, conflicted: 3, dirty: 5 } }), diag('merge-conflict', 'banned-deps'), deps(2));
  assert.equal(t.kind, 'block');
  assert.equal(t.action, null);
  assert.match(t.text, /3개/);
});

test('금지 의존성은 막힘, 설치보다 먼저', () => {
  const t = nowTask(repo({ level: 0 }), diag('banned-deps', 'deps-stale'), deps(2));
  assert.equal(t.kind, 'block');
  assert.match(t.text, /설치하면 안 되는 의존성 2개/);
});

test('의존성이 어긋나면 install', () => {
  const t = nowTask(repo({ level: 3, git: { dirty: 4 }, handshake: { state: 'stale' } }), diag('deps-stale'), deps(2));
  assert.deepEqual([t.kind, t.action], ['do', 'install']);
  // deps 를 안 넘기면 진단 결과로 판단한다
  assert.equal(nowTask(repo(), diag('deps-stale')).action, 'install');
});

test('L3 이상에서 미커밋 변경이 있으면 커밋 먼저 (버튼 없음), L3 미만은 아님', () => {
  const t = nowTask(repo({ level: 3, git: { dirty: 22 }, handshake: { state: 'stale' } }), diag(), deps());
  assert.deepEqual([t.kind, t.action], ['do', null]);
  assert.match(t.text, /22건/);
  const low = nowTask(repo({ level: 1, git: { dirty: 22 } }), diag(), deps());
  assert.deepEqual([low.kind, low.toLevel], ['next', 2]);
});

test('하네스 버전 지연 또는 밀린 표준이면 현재 레벨 다시 적용', () => {
  const t = nowTask(repo({ level: 2, handshake: { state: 'stale' }, config: { harness: '0.1.0' } }), diag(), deps());
  assert.deepEqual([t.kind, t.action, t.toLevel], ['do', 'sync', 2]);
  assert.ok(t.text.includes(`0.1.0 → ${harnessVersion()}`));
  const p = nowTask(repo({ level: 3 }), diag(), deps(), { pendingSync: 4 });
  assert.deepEqual([p.action, p.toLevel], ['sync', 3]);
  // 미편입 레포는 sync 대상이 아니다
  assert.equal(nowTask(repo({ handshake: { state: 'stale' } }), diag(), deps(), { pendingSync: 3 }).toLevel, 0);
});

test('미편입은 L0, 그다음은 한 칸씩, L3 에서 끝 (L4 는 권하지 않음)', () => {
  const l0 = nowTask(repo(), diag(), deps());
  assert.deepEqual([l0.kind, l0.action, l0.toLevel], ['next', 'promote', 0]);
  for (const lv of [0, 1, 2]) assert.equal(nowTask(repo({ level: lv }), diag(), deps()).toLevel, lv + 1);
  for (const lv of [3, 4]) {
    const t = nowTask(repo({ level: lv }), diag(), deps());
    assert.deepEqual([t.kind, t.action], ['done', null]);
  }
});

test('마지막 verify 가 변경 뒤에 실패했으면 승급 대신 verify 다시 (job 을 넘긴 경우만)', () => {
  const r = repo({ level: 2 });                              // dir 이 없으면 변경 시각은 0
  const failed = { script: 'verify', status: 'failed', endedAt: Date.now() };
  const t = nowTask(r, diag(), deps(), { job: failed });
  assert.deepEqual([t.kind, t.action], ['do', 'verify']);
  assert.equal(nowTask(r, diag(), deps(), { job: { ...failed, status: 'passed' } }).action, 'promote');
  assert.equal(nowTask(r, diag(), deps()).action, 'promote');             // CLI: 실행 기록 없음
  // 설치가 더 급하다
  assert.equal(nowTask(r, diag(), deps(1), { job: failed }).action, 'install');
});

import { orderSteps } from '../core/steps.js';
import { checkLevel, TOP_LEVEL } from '../core/levels.js';

const orderOf = (r, d = deps(), opts = {}) => orderSteps(r, d, nowTask(r, diag(), d, opts), opts);
const nowIds = (o) => o.filter((s) => s.state === 'now').map((s) => s.id);

test('순서 목록의 "지금" 칸은 언제나 nowTask 가 고른 칸 하나', () => {
  const pkg = { scripts: { verify: 'x' } };
  const cases = [
    [repo({ level: 1, git: { dirty: 5 }, pkg }), 'level'],          // L3 미만 미커밋은 '지금'이 아니다
    [repo({ level: 3, git: { dirty: 5 }, pkg }), 'git'],
    [repo({ level: 2, git: { inMerge: true, conflicted: 1 }, pkg }), 'git'],
    [repo({ level: 2, handshake: { state: 'stale' }, pkg }), 'sync'],
    [repo({ level: null, pkg }), 'level'],
  ];
  for (const [r, id] of cases) assert.deepEqual(nowIds(orderOf(r)), [id], JSON.stringify(r));
  assert.deepEqual(nowIds(orderOf(repo({ level: 0, pkg }), deps(2))), ['install']);
  assert.deepEqual(nowIds(orderOf(repo({ level: 3, pkg }))), []);                       // 완료
});

test('재적용이 필요하면 순서에 sync 칸이 생기고, 아니면 없다', () => {
  const pkg = { scripts: {} };
  assert.ok(orderOf(repo({ level: 2, pkg }), deps(), { pendingSync: 2 }).some((s) => s.id === 'sync'));
  assert.ok(!orderOf(repo({ level: 2, pkg })).some((s) => s.id === 'sync'));
  // L3 미만에서 미커밋은 '권장'으로만
  const git = orderOf(repo({ level: 1, git: { dirty: 3 }, pkg })).find((s) => s.id === 'git');
  assert.equal(git.state, 'wait');
  assert.match(git.label, /권장/);
  // package.json 이 없으면 설치·verify 는 건너뜀
  assert.deepEqual(orderOf(repo({ level: 0 })).filter((s) => s.state === 'skip').map((s) => s.id), ['install', 'verify']);
});

test('checkLevel — 정수 0..구현된 최고 레벨만', () => {
  for (const ok of [0, 1, 2, 3, '2']) assert.equal(checkLevel(ok).ok, true, String(ok));
  for (const bad of [4, -1, 1.5, NaN, '2a', '', null, undefined, '1e0x']) assert.equal(checkLevel(bad).ok, false, String(bad));
  assert.equal(TOP_LEVEL, 3);
  assert.match(checkLevel(4).error, /구현되지 않았/);
});

test('otherIssues: nowTask 가 다루지 않는 오류·경고만 센다', async () => {
  const { otherIssues } = await import('../core/steps.js');
  const d = { findings: [
    { id: 'deps-stale', severity: 'error', title: '의존성 설치 필요' },
    { id: 'handshake', severity: 'warn', title: '미편입' },
    { id: 'lint-not-shared', severity: 'warn', title: '공용 린트 설정이 적용되지 않음' },
    { id: 'dirty', severity: 'info', title: '미커밋 변경 3건' },
  ] };
  const r = otherIssues(d);
  assert.deepEqual(r.map((x) => x.id), ['lint-not-shared']);
  assert.deepEqual(otherIssues(null), []);
});
