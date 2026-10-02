import { fakeRepo, write } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { planLevel } from '../core/plan.js';
import { applyPlan } from '../core/apply.js';
import { nowTask } from '../core/steps.js';
import { hasEslintConfig } from '../core/eslintcfg.js';

const scriptsAt = (repo, level) => JSON.parse(planLevel(repo, level).actions.find((a) => a.rel === 'package.json').after).scripts;
const pkg = { name: 'x', scripts: { test: 'vitest run', build: 'vite build' } };
let n = 0;
const repoNamed = (opts) => fakeRepo(`lint-${++n}`, opts);

test('ESLint 설정을 알아본다 (flat · 옛 .eslintrc · package.json eslintConfig)', () => {
  assert.equal(hasEslintConfig(repoNamed({ pkg })), false);
  for (const f of ['eslint.config.mjs', '.eslintrc.json', '.eslintrc']) {
    const r = repoNamed({ pkg }); write(`${r.name}/${f}`, '{}'); r.files = undefined;
    assert.equal(hasEslintConfig(r), true, f);
  }
  assert.equal(hasEslintConfig(repoNamed({ pkg: { ...pkg, eslintConfig: {} } })), true);
});

test('L2: ESLint 설정이 없으면 verify 에 lint 를 넣지 않는다 (lint 스크립트는 만든다)', () => {
  const s = scriptsAt(repoNamed({ pkg }), 2);
  assert.equal(s.verify, 'pnpm test && pnpm build');
  assert.equal(s.lint, 'eslint .');
});

test('L2: 설정이 있으면 예전과 같다 · ESLint 가 아닌 lint 는 그대로 넣는다', () => {
  const r = repoNamed({ pkg }); write(`${r.name}/eslint.config.js`, 'export default [];\n');
  assert.equal(scriptsAt(r, 2).verify, 'pnpm lint && pnpm test && pnpm build');
  const other = repoNamed({ pkg: { ...pkg, scripts: { ...pkg.scripts, lint: 'biome check .' } } });
  assert.equal(scriptsAt(other, 2).verify, 'pnpm lint && pnpm test && pnpm build');
});

test('L3: 하네스가 L2에서 lint 없이 만든 verify 만 lint 포함으로 바꾼다', () => {
  const r = repoNamed({ pkg });
  applyPlan(r, planLevel(r, 2));
  const at2 = { ...r, pkg: JSON.parse(planLevel(r, 2).actions.find((a) => a.rel === 'package.json').after), level: 2 };
  assert.equal(at2.pkg.scripts.verify, 'pnpm test && pnpm build');
  const plan3 = planLevel(at2, 3);
  const pj = plan3.actions.find((a) => a.rel === 'package.json');
  assert.equal(JSON.parse(pj.after).scripts.verify, 'pnpm lint && pnpm test && pnpm build');
  assert.match(pj.note, /verify 에 lint 추가/);
  assert.ok(plan3.actions.some((a) => a.rel === '.kmjharness/eslint.config.js'), 'L3가 설정을 넣는다');

  // 사람이 고친 verify 는 그대로
  const custom = { ...at2, pkg: { ...at2.pkg, scripts: { ...at2.pkg.scripts, verify: 'pnpm test && pnpm build && echo ok' } } };
  assert.equal(JSON.parse(planLevel(custom, 3).actions.find((a) => a.rel === 'package.json').after).scripts.verify,
    'pnpm test && pnpm build && echo ok');
});

test('L3: 공용 ESLint 설정이 없는 프로파일이면 verify 에 lint 를 넣지 않는다', () => {
  const r = repoNamed({ pkg, detectedProfile: 'node-service' });
  assert.equal(scriptsAt(r, 3).verify, 'pnpm test && pnpm build');
});

test('L1 → L3 한 번에 가면 처음부터 lint 포함', () => {
  assert.equal(scriptsAt(repoNamed({ pkg }), 3).verify, 'pnpm lint && pnpm test && pnpm build');
});

test('ESLint 설정이 없어 verify 가 실패한 L2 레포에는 L3를 권한다 (L3가 고치므로)', () => {
  const r = repoNamed({ pkg: { ...pkg, scripts: { ...pkg.scripts, lint: 'eslint .', verify: 'pnpm lint && pnpm test && pnpm build' } } });
  const rr = { ...r, level: 2, git: {}, handshake: { state: 'linked' } };
  const job = { script: 'verify', status: 'failed', endedAt: Date.now() + 1000 };
  const t = nowTask(rr, { findings: [] }, { stale: [], missing: [], needsInstall: false }, { job });
  assert.deepEqual([t.kind, t.action, t.toLevel], ['next', 'promote', 3]);
  assert.match(t.why, /ESLint 설정/);
  // 설정이 있는데 실패했으면 원래대로 verify 고치기
  write(`${r.name}/eslint.config.js`, 'export default [];\n'); rr.files = undefined;
  assert.equal(nowTask(rr, { findings: [] }, { stale: [], missing: [], needsInstall: false }, { job }).action, 'verify');
});

test('이을 스크립트가 없으면 빈 verify 를 만들지 않는다', () => {
  const s = scriptsAt(repoNamed({ pkg: { name: 'x', scripts: {} }, detectedProfile: 'node-service' }), 2);
  assert.ok(!('verify' in s));
  assert.equal(s.lint, 'eslint .');
});
