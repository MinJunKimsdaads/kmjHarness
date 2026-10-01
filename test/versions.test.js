import { write, fakeRepo } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolchainRows } from '../core/versions.js';

write('lay/h/AGENTS.fragment.md', '## x');
write('lay/h/toolchain.json', { versions: { three: '^0.170.0', react: '^1.0.0' } });

test('층이 더한 버전은 새 이름만 받고, 하네스 표준은 덮지 못한다', () => {
  const repo = fakeRepo('vgame', { detectedProfile: 'game',
    pkg: { dependencies: { react: '^19.1.0', three: '^0.169.0' } }, config: { layers: ['lay/h'] } });
  repo.deps = { react: '^19.1.0', three: '^0.169.0' };
  const rows = Object.fromEntries(toolchainRows(repo).map((r) => [r.name, r]));
  assert.equal(rows.three.standard, '^0.170.0');
  assert.equal(rows.react.standard, '^19.0.0');
  assert.equal(rows.zustand.status, 'missing');            // game 은 zustand 가 있어야 함
});
