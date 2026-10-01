import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harnessRoot } from '../core/paths.js';
import { profileChain, profileFile, profileFragments } from '../core/profiles.js';

const prof = (...seg) => fs.readFileSync(path.join(harnessRoot, 'profiles', ...seg), 'utf8');

test('profile.json 이 없는 기존 프로파일은 자기 자신만 본다', () => {
  for (const p of ['react-vite', 'next', 'node-service', 'static', 'data']) {
    assert.deepEqual(profileChain(p), [p]);
    assert.equal(profileFragments(p), prof(p, 'AGENTS.fragment.md').trim());
  }
});

test('game 은 react-vite 를 물려받는다', () => {
  assert.deepEqual(profileChain('game'), ['game', 'react-vite']);
  const frag = profileFragments('game');
  const parent = prof('react-vite', 'AGENTS.fragment.md').trim();
  const own = prof('game', 'AGENTS.fragment.md').trim();
  assert.equal(frag, `${parent}\n\n${own}`);           // 조상 먼저
});

test('자식에 없는 파일은 부모 것을 쓴다', () => {
  assert.equal(profileFile('game', 'eslint.root.js'), prof('react-vite', 'eslint.root.js'));
  assert.equal(profileFile('game', 'eslint.config.js'), prof('game', 'eslint.config.js'));
  assert.equal(profileFile('없는-프로파일', 'eslint.config.js'), null);
});

test('game ESLint 설정의 공통 부분은 react-vite 와 글자까지 같다', () => {
  const body = (t, endMark) => t.slice(t.indexOf('export default'), t.indexOf(endMark)).replace(/\s+$/, '');
  const parent = body(prof('react-vite', 'eslint.config.js'), '  // Prettier와');
  const game = body(prof('game', 'eslint.config.js'), '  // ── game 규칙');
  assert.equal(game, parent, 'react-vite 의 eslint.config.js 를 바꿨다면 game 것도 같이 바꾸세요');
});
