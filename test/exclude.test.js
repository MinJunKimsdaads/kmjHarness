import { ws, write, fakeRepo } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readWorkspace, writeWorkspace, setExcluded, excludedNames } from '../core/registry.js';
import { planLevel } from '../core/plan.js';
import { applyPlan } from '../core/apply.js';
import { scanWorkspace, quickScanWorkspace } from '../core/scan.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'index.js');
const kmjh = (...args) => execFileSync(process.execPath, [cli, ...args], { env: process.env, encoding: 'utf8' });

write('keep/kmjharness.json', { harness: '0.0.1', profile: 'data', level: 0 });
write('datafolder/readme.txt', 'x');

test('레지스트리는 KMJH_REGISTRY 로 옮겨진다 (테스트가 진짜 workspace.json 을 건드리지 않음)', () => {
  writeWorkspace({ repos: {} });
  assert.ok(fs.existsSync(path.join(ws, 'workspace.json')));
});

test('setExcluded 는 중복 없이 넣고 빼며, 다른 키를 보존한다', () => {
  writeWorkspace({ harnessVersion: '9.9.9', repos: { a: { level: 1 } } });
  setExcluded('datafolder', true);
  setExcluded('datafolder', true);
  assert.deepEqual(excludedNames(), ['datafolder']);
  assert.equal(readWorkspace().repos.a.level, 1);
  setExcluded('datafolder', false);
  assert.deepEqual(excludedNames(), []);
});

test('scan 결과에 excluded 표시가 붙는다 (목록에서 숨기는 건 호출하는 쪽)', () => {
  writeWorkspace({ repos: {}, exclude: ['datafolder'] });
  const full = Object.fromEntries(scanWorkspace().map((r) => [r.name, r.excluded]));
  const quick = Object.fromEntries(quickScanWorkspace().map((r) => [r.name, r.excluded]));
  assert.equal(full.datafolder, true); assert.equal(full.keep, false);
  assert.deepEqual(quick, full);
});

test('kmjh scan 은 exclude 를 보존한다', () => {
  writeWorkspace({ repos: { ghost: { level: 0 } }, exclude: ['datafolder'] });
  kmjh('scan');
  const w = readWorkspace();
  assert.deepEqual(w.exclude, ['datafolder']);
  assert.ok(w.repos.keep);            // 정상 동작도 그대로
  assert.ok(!w.repos.ghost);
});

test('applyPlan 은 exclude 를 보존한다', () => {
  writeWorkspace({ repos: {}, exclude: ['datafolder'] });
  const repo = fakeRepo('applied', { detectedProfile: 'data' });
  applyPlan(repo, planLevel(repo, 0));
  const w = readWorkspace();
  assert.deepEqual(w.exclude, ['datafolder']);
  assert.equal(w.repos.applied.level, 0);
});

test('kmjh exclude / include, list · doctor 는 제외한 폴더를 숨기고 개수만 알린다', () => {
  writeWorkspace({ repos: {} });
  kmjh('exclude', 'datafolder');
  assert.deepEqual(excludedNames(), ['datafolder']);
  const list = kmjh('list');
  assert.ok(!/^datafolder\s/m.test(list));
  assert.match(list, /제외한 폴더 1개/);
  assert.match(list, /지금 할 일/);
  const doctor = kmjh('doctor');
  assert.ok(!doctor.includes('datafolder'));
  assert.match(doctor, /제외한 폴더 1개/);
  assert.match(kmjh('doctor', 'datafolder'), /datafolder/);    // 이름을 주면 보여준다
  kmjh('include', 'datafolder');
  assert.deepEqual(excludedNames(), []);
  assert.match(kmjh('list'), /datafolder/);
  assert.throws(() => execFileSync(process.execPath, [cli, 'exclude', '없는폴더'], { env: process.env, stdio: 'pipe' }));
});
