import { write, ws } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { detectProfile, collectDeps } from '../core/detect.js';

const p = (deps) => ({ pkg: { dependencies: deps }, hasHtml: false, hasDataOnly: false });

test('기존 판정은 그대로', () => {
  assert.equal(detectProfile(p({ next: '1', react: '1' })), 'next');
  assert.equal(detectProfile(p({ react: '1', vite: '1' })), 'react-vite');
  assert.equal(detectProfile(p({ react: '1' })), 'react-legacy');
  assert.equal(detectProfile(p({ express: '1' })), 'node-service');
  assert.equal(detectProfile({ pkg: null, hasHtml: true }), 'static');
  assert.equal(detectProfile({ pkg: null, hasHtml: false, hasDataOnly: true }), 'data');
});

test('three + react + vite → game', () => {
  assert.equal(detectProfile(p({ react: '1', vite: '1', three: '1' })), 'game');
  assert.equal(detectProfile(p({ react: '1', '@vitejs/plugin-react': '1', three: '1' })), 'game');
  assert.equal(detectProfile(p({ react: '1', three: '1' })), 'react-legacy');   // vite 없으면 game 아님
});

test('모노레포는 하위 패키지 의존성까지 합친다', () => {
  const dir = path.join(ws, 'mono');
  write('mono/pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - games/sample   # 주석\nonlyBuiltDependencies:\n  - esbuild\n");
  const root = { name: 'mono', devDependencies: { typescript: '^5.8.0' } };
  write('mono/package.json', root);
  write('mono/packages/core/package.json', { name: '@x/core', dependencies: { three: '^0.170.0', typescript: '^9' } });
  write('mono/packages/notapkg/readme.md', '');
  write('mono/games/sample/package.json', { name: 'sample', dependencies: { react: '^19', vite: '^7', '@x/core': 'workspace:*' } });
  const r = collectDeps(dir, root);
  assert.equal(r.monorepo, true);
  assert.deepEqual(r.packages, ['games/sample', 'packages/core']);
  assert.equal(r.deps.typescript, '^5.8.0');              // 루트 선언이 우선
  assert.equal(r.deps.three, '^0.170.0');
  assert.ok(!('@x/core' in r.deps));                     // workspace: 참조는 뺀다
  assert.ok(!('esbuild' in r.deps));                     // packages 밖의 목록은 무시
  assert.equal(detectProfile({ pkg: root, deps: r.deps }), 'game');
});

test('모노레포가 아니면 루트 의존성 그대로', () => {
  const root = { dependencies: { react: '1' }, devDependencies: { vite: '1' } };
  write('single/package.json', root);
  const r = collectDeps(path.join(ws, 'single'), root);
  assert.equal(r.monorepo, false);
  assert.deepEqual(r.deps, { react: '1', vite: '1' });
});

test('package.json 의 workspaces 도 읽는다', () => {
  const root = { workspaces: ['apps/*'] };
  write('npmws/package.json', root);
  write('npmws/apps/web/package.json', { dependencies: { react: '1' } });
  assert.deepEqual(collectDeps(path.join(ws, 'npmws'), root).packages, ['apps/web']);
});
