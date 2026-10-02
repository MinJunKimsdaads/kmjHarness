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
