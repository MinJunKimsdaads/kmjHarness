import { write, fakeRepo, ws } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { planLevel } from '../core/plan.js';
import { resolveLayers } from '../core/profiles.js';

const after = (plan, rel) => plan.actions.find((a) => a.rel === rel)?.after;
const HNS = '## 핵앤슬래시 규약 (테스트)\n\n- 틀은 framework/ 에 있다.';

write('kmjHackNSlash/harness/AGENTS.fragment.md', HNS + '\n');
write('kmjHackNSlash/harness/layer.json', { name: 'hacknslash', version: '0.2.0' });
write('kmjHackNSlash/harness/toolchain.json', { versions: { three: '^0.170.0', react: '^1.0.0' } });

test('layers 가 없으면 kmjharness.json 에 layers 키가 생기지 않는다', () => {
  const repo = fakeRepo('plain', { pkg: { name: 'plain' } });
  const cfg = JSON.parse(after(planLevel(repo, 0), 'kmjharness.json'));
  assert.ok(!('layers' in cfg));
});

test('선언된 프로파일이 감지값보다 우선한다', () => {
  const repo = fakeRepo('declared', { detectedProfile: 'game', profile: 'react-vite',
    config: { profile: 'react-vite', level: 1 } });
  const plan = planLevel(repo, 1);
  assert.equal(JSON.parse(after(plan, 'kmjharness.json')).profile, 'react-vite');
  assert.ok(!after(plan, 'AGENTS.md').includes('(game'));
});

test('game 프로파일 AGENTS.md 는 base → react-vite → game 순서', () => {
  const repo = fakeRepo('g1', { detectedProfile: 'game' });
  const md = after(planLevel(repo, 1), 'AGENTS.md');
  const i = (s) => md.indexOf(s);
  assert.ok(i('공통 규약 (kmjHarness base)') >= 0);
  assert.ok(i('공통 규약 (kmjHarness base)') < i('스택 규약 (react-vite)'));
  assert.ok(i('스택 규약 (react-vite)') < i('스택 규약 (game'));
  assert.ok(i('스택 규약 (game') < i('<!-- kmjharness:end'));
});

test('바깥 층 조각은 관리 블록 끝에 붙고, 선언은 보존된다', () => {
  const layers = ['kmjHackNSlash/harness'];
  const repo = fakeRepo('g2', { detectedProfile: 'game', config: { profile: 'game', level: 3, layers } });
  const plan = planLevel(repo, 3);
  const md = after(plan, 'AGENTS.md');
  assert.ok(md.indexOf('스택 규약 (game') < md.indexOf(HNS));
  assert.ok(md.indexOf(HNS) < md.indexOf('<!-- kmjharness:end'));
  assert.deepEqual(JSON.parse(after(plan, 'kmjharness.json')).layers, layers);
  // game 은 자기 eslint.config.js, 루트 파일은 react-vite 것을 물려받음
  assert.ok(after(plan, '.kmjharness/eslint.config.js').includes('game 규칙'));
  assert.ok(after(plan, 'eslint.config.js').includes("from './.kmjharness/eslint.config.js'"));
  assert.deepEqual(plan.warnings.filter((w) => w.includes('바깥 층')), []);
});

test('층 경로: 두 가지 모양, 워크스페이스 밖 거부, 조각 없음', () => {
  const repo = fakeRepo('g3', { config: { layers: [
    'kmjHackNSlash/harness',
    { name: 'hns', from: '../kmjHackNSlash/harness' },
    { name: 'escape', from: '../../etc' },
    'kmjHackNSlash/nothing',
  ] } });
  const r = resolveLayers(repo);
  assert.equal(r[0].ok, true); assert.equal(r[0].name, 'hacknslash'); assert.equal(r[0].version, '0.2.0');
  assert.equal(r[1].ok, true); assert.equal(r[1].name, 'hns');
  assert.equal(r[2].ok, false); assert.match(r[2].problem, /워크스페이스 밖/);
  assert.equal(r[3].ok, false); assert.match(r[3].problem, /AGENTS\.fragment\.md/);
  const plan = planLevel(repo, 1);
  assert.equal(plan.warnings.filter((w) => w.includes('바깥 층')).length, 2);
  assert.equal(path.dirname(r[0].dir), path.join(ws, 'kmjHackNSlash'));
});
