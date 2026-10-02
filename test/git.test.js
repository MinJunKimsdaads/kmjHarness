import { ws, write, git, mergeConflictRepo } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanRepo, scanRepoAsync } from '../core/scan.js';
import { diagnose } from '../core/doctor.js';
import { nowTask } from '../core/steps.js';
import { planLevel } from '../core/plan.js';
import { applyPlan } from '../core/apply.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'index.js');
const kmjh = (...args) => spawnSync(process.execPath, [cli, ...args], { env: process.env, encoding: 'utf8' });

mergeConflictRepo('conflicted');
mergeConflictRepo('resolved');
write('resolved/a.txt', 'fixed\n');
git('resolved', 'add', 'a.txt');          // 충돌은 풀었지만 커밋은 안 함

// 체리픽 도중 (충돌을 풀고 add 만 한 상태)
mergeConflictRepo('picking');
git('picking', 'merge', '--abort');
try { git('picking', 'cherry-pick', 'other'); } catch { /* 충돌 */ }
write('picking/a.txt', 'fixed\n');
git('picking', 'add', 'a.txt');

write('clean/a.txt', 'x\n');
git('clean', 'init', '-q'); git('clean', 'add', '-A'); git('clean', 'commit', '-qm', 'init');

test('충돌 파일이 남은 병합은 inMerge', () => {
  const g = scanRepo('conflicted').git;
  assert.equal(g.inMerge, true);
  assert.equal(g.conflicted, 1);
  assert.equal(g.operation, 'merge');
});

test('충돌을 풀고 add 만 한 병합도 inMerge — 커밋 전까지는 막는다', () => {
  const r = scanRepo('resolved');
  assert.equal(r.git.conflicted, 0);
  assert.equal(r.git.inMerge, true);
  assert.equal(r.git.operation, 'merge');
  const d = diagnose(r);
  assert.ok(d.findings.some((f) => f.id === 'merge-conflict' && f.severity === 'error'));
  const t = nowTask(r, d, { stale: [], missing: [], needsInstall: false });
  assert.equal(t.kind, 'block');
  assert.equal(t.action, null);
  assert.match(t.text, /병합 마무리/);
});

test('체리픽 도중도 inMerge', () => {
  const g = scanRepo('picking').git;
  assert.equal(g.inMerge, true);
  assert.equal(g.operation, 'cherry-pick');
});

test('깨끗한 레포는 inMerge 아님, 비동기 스캔은 동기와 같은 결과', async () => {
  for (const name of ['clean', 'resolved', 'conflicted']) {
    assert.deepEqual(await scanRepoAsync(name), scanRepo(name));
  }
  assert.equal(scanRepo('clean').git.inMerge, false);
  assert.equal(scanRepo('clean').git.operation, null);
});

test('applyPlan 은 병합 중인 레포에 쓰지 않는다 (core 공통 판단)', () => {
  const r = scanRepo('resolved');
  assert.throws(() => applyPlan(r, planLevel(r, 0)), (e) => e.code === 'APPLY_BLOCKED' && /병합/.test(e.message));
  assert.ok(!fs.existsSync(path.join(ws, 'resolved', 'kmjharness.json')));
});

test('kmjh promote --apply 도 병합 중이면 거부하고 0 이 아닌 값으로 끝난다', () => {
  for (const name of ['conflicted', 'resolved']) {
    const p = kmjh('promote', name, '--to', '0', '--apply');
    assert.notEqual(p.status, 0);
    assert.match(p.stdout + p.stderr, /적용할 수 없음/);
    assert.ok(!fs.existsSync(path.join(ws, name, 'kmjharness.json')));
  }
  // 미리보기(--apply 없음)는 그대로 보여준다
  assert.equal(kmjh('plan', 'resolved', '--to', '0').status, 0);
});
