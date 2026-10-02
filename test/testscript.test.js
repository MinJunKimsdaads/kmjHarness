import { fakeRepo } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { oneShotTest, testRunner } from '../core/testscript.js';
import { planLevel } from '../core/plan.js';
import { diagnose } from '../core/doctor.js';

// L2 를 계획했을 때 package.json 의 scripts
const l2 = (testCmd) => {
  const repo = fakeRepo(`ts-${Math.random().toString(36).slice(2)}`,
    { pkg: { name: 'x', scripts: { build: 'vite build', ...(testCmd ? { test: testCmd } : {}) } } });
  return JSON.parse(planLevel(repo, 2).actions.find((a) => a.rel === 'package.json').after).scripts;
};

test('러너 판별과 1회 실행 명령', () => {
  assert.equal(testRunner('vitest'), 'vitest');
  assert.equal(testRunner('cross-env CI=1 ./node_modules/.bin/vitest'), 'vitest');
  assert.equal(testRunner('jest --ci'), 'jest');
  assert.equal(testRunner('node --test'), 'other');
  assert.equal(oneShotTest('vitest'), 'vitest run');
  assert.equal(oneShotTest('vitest --coverage'), 'vitest run --coverage');
  assert.equal(oneShotTest('vitest watch'), 'vitest run');
  assert.equal(oneShotTest('vitest run'), null);
  assert.equal(oneShotTest('vitest --run'), null);
  assert.equal(oneShotTest('cross-env CI=1 vitest'), 'cross-env CI=1 vitest run');
  assert.equal(oneShotTest('jest --watch'), 'jest');
  assert.equal(oneShotTest('jest --watchAll --ci'), 'jest --ci');
  assert.equal(oneShotTest('jest'), null);
  for (const other of ['node --test', 'mocha', 'ava', 'node --test --watch']) assert.equal(oneShotTest(other), null);
});

test('vitest 레포의 L2 결과는 예전과 글자까지 같다', () => {
  assert.deepEqual(l2('vitest'), { build: 'vite build', test: 'vitest run', 'test:watch': 'vitest', lint: 'eslint .',
    'lint:fix': 'eslint . --fix', format: 'prettier --write .', 'format:check': 'prettier --check .',
    'test:coverage': 'vitest run --coverage', verify: 'pnpm lint && pnpm test && pnpm build' });
  assert.deepEqual(l2('vitest --coverage'), { build: 'vite build', test: 'vitest run --coverage', 'test:watch': 'vitest --coverage',
    lint: 'eslint .', 'lint:fix': 'eslint . --fix', format: 'prettier --write .', 'format:check': 'prettier --check .',
    'test:coverage': 'vitest run --coverage --coverage', verify: 'pnpm lint && pnpm test && pnpm build' });
  assert.deepEqual(l2('vitest run'), { build: 'vite build', test: 'vitest run', lint: 'eslint .', 'lint:fix': 'eslint . --fix',
    format: 'prettier --write .', 'format:check': 'prettier --check .', 'test:watch': 'vitest', 'test:coverage': 'vitest run --coverage',
    verify: 'pnpm lint && pnpm test && pnpm build' });
  assert.equal(l2(undefined)['test:coverage'], 'vitest run --coverage');
});

test('node --test · mocha 는 건드리지 않는다 (예전엔 "node run --test")', () => {
  for (const cmd of ['node --test', 'mocha']) {
    const s = l2(cmd);
    assert.equal(s.test, cmd);
    assert.ok(!('test:watch' in s) && !('test:coverage' in s), '모르는 러너에 플래그를 붙이지 않는다');
    assert.equal(s.verify, 'pnpm lint && pnpm test && pnpm build');
  }
});

test('jest 는 --watch 만 떼고, watch/coverage 변형은 jest 방식으로', () => {
  assert.deepEqual([l2('jest --watch').test, l2('jest --watch')['test:watch'], l2('jest --watch')['test:coverage']],
    ['jest', 'jest --watch', 'jest --coverage']);
  assert.equal(l2('jest').test, 'jest');
});

test('doctor 는 아는 러너의 watch 모드만 경고한다', () => {
  const finding = (cmd) => diagnose({ ...fakeRepo(`d-${Math.random().toString(36).slice(2)}`,
    { pkg: { name: 'x', scripts: { test: cmd } }, config: { level: 2 } }), handshake: { state: 'linked' } })
    .findings.find((f) => f.id === 'test-watch');
  assert.ok(finding('vitest'));
  assert.ok(finding('jest --watch'));
  assert.equal(finding('node --test'), undefined);
  assert.equal(finding('vitest run'), undefined);
});
