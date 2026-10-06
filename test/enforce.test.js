// L4 강제 — 커밋·푸시 순간에 표준이 지켜지는지 보게 만드는 단계.
// 이 레벨의 약속: 설정을 더하되 '설치된 패키지의 버전은 올리지 않는다'.
import { ws, write, fakeRepo } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planLevel } from '../core/plan.js';
import { applyPlan } from '../core/apply.js';
import { scanRepo } from '../core/scan.js';
import { diagnose } from '../core/doctor.js';
import { insertStep, hasStep } from '../core/verifyscript.js';

const base = { name: 'e', scripts: { build: 'vite build', test: 'vitest run', lint: 'eslint .' } };
const pkgOf = (plan) => JSON.parse(plan.actions.find((a) => a.rel === 'package.json').after);
const fileOf = (plan, rel) => plan.actions.find((a) => a.rel === rel)?.after;
const npmRepo = (name, pkg) => ({ ...fakeRepo(name, { pkg }), packageManager: 'npm' });

test('L4 는 훅·Node 고정·blame 목록을 깐다', () => {
  const plan = planLevel(fakeRepo('e-files', { pkg: base }), 4);
  for (const rel of ['lefthook.yml', '.nvmrc', '.git-blame-ignore-revs']) {
    assert.ok(fileOf(plan, rel), `${rel} 가 계획에 있어야 한다`);
  }
  assert.match(fileOf(plan, '.nvmrc'), /^\d+/, 'Node 버전만 들어간다');
});

test('verify 에 format:check 를 끼워 넣되 레포 고유 스텝은 보존한다', () => {
  // age-of-sail 처럼 레포가 자기 스텝을 앞에 둔 경우
  const pkg = { ...base, scripts: { ...base.scripts, 'format:check': 'prettier --check .',
    verify: 'pnpm framework:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build' } };
  const v = pkgOf(planLevel(fakeRepo('e-verify', { pkg }), 4)).scripts.verify;
  assert.equal(v, 'pnpm framework:check && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build');
  assert.ok(v.includes('framework:check'), '레포가 더해 둔 스텝이 살아 있어야 한다');
});

test('format:check 삽입은 여러 번 해도 같다', () => {
  const once = insertStep('npm run lint && npm run build', { pm: 'npm', script: 'format:check', before: 'lint' });
  assert.equal(insertStep(once, { pm: 'npm', script: 'format:check', before: 'lint' }), once);
  assert.ok(hasStep(once, 'format:check') && hasStep(once, 'lint'));
});

test('packageManager 는 지금 쓰는 매니저로 고정한다 (pnpm 으로 바꾸지 않는다)', () => {
  const npmPkg = pkgOf(planLevel(npmRepo('e-npm', base), 4));
  assert.match(npmPkg.packageManager, /^npm@/, 'npm 레포는 npm 으로 고정');
  const pnpmPkg = pkgOf(planLevel(fakeRepo('e-pnpm', { pkg: base }), 4));
  assert.match(pnpmPkg.packageManager, /^pnpm@/);
});

test('L4 는 설치된 패키지의 버전을 올리지 않는다', () => {
  const pkg = { ...base, devDependencies: { react: '^18.0.0', vite: '^5.0.0', prettier: '^9.9.9' } };
  const after = pkgOf(planLevel(fakeRepo('e-keep', { pkg }), 4)).devDependencies;
  assert.equal(after.react, '^18.0.0', 'react 는 건드리지 않는다');
  assert.equal(after.vite, '^5.0.0', 'vite 도 건드리지 않는다');
  assert.equal(after.prettier, '^9.9.9', '이미 표준보다 높으면 그대로 둔다');
  assert.ok(after.lefthook, '훅 도구는 더한다');
});

test('prepare 스크립트는 없을 때만 더하고, .git 이 없어도 설치가 깨지지 않게 한다', () => {
  const p = pkgOf(planLevel(fakeRepo('e-prepare', { pkg: base }), 4)).scripts.prepare;
  assert.match(p, /lefthook install/);
  assert.match(p, /\|\| true/, '.git 없는 환경에서 install 전체를 실패시키지 않는다');

  const keep = { ...base, scripts: { ...base.scripts, prepare: 'husky' } };
  assert.equal(pkgOf(planLevel(fakeRepo('e-prepare2', { pkg: keep }), 4)).scripts.prepare, 'husky', '기존 prepare 는 덮지 않는다');
});

test('ESLint 설정이 없으면 lint 훅을 넣지 않는다', () => {
  const withCfg = fakeRepo('e-lint', { pkg: base });
  write('e-lint/eslint.config.js', 'export default [];');
  const yml = fileOf(planLevel({ ...withCfg, files: fs.readdirSync(path.join(ws, 'e-lint')) }, 4), 'lefthook.yml');
  assert.match(yml, /eslint --fix/);

  const noCfg = fileOf(planLevel(fakeRepo('e-nolint', { pkg: base }), 4), 'lefthook.yml');
  assert.ok(!/eslint --fix/.test(noCfg), '설정이 없으면 eslint 훅은 빠진다');
  assert.match(noCfg, /ESLint 설정이 없어/, '왜 빠졌는지 적어 둔다');
  assert.match(noCfg, /prettier --write/, '포맷 훅은 그대로 있다');
});

test('매니저에 맞는 실행 명령을 쓴다', () => {
  assert.match(fileOf(planLevel(fakeRepo('e-x1', { pkg: base }), 4), 'lefthook.yml'), /pnpm exec prettier/);
  assert.match(fileOf(planLevel(npmRepo('e-x2', base), 4), 'lefthook.yml'), /npx prettier/);
  assert.match(fileOf(planLevel(npmRepo('e-x3', base), 4), 'lefthook.yml'), /run: npm run verify/);
});

test('doctor: 훅이 없으면 오류, 설정만 있고 설치 안 됐으면 경고', () => {
  const name = 'e-doc';
  applyPlan(fakeRepo(name, { pkg: base }), planLevel(fakeRepo(name, { pkg: base }), 3));
  const at3 = diagnose(scanRepo(name));
  // L3 레포에게는 아직 '예고(info)'다 — 레벨보다 높은 규칙이므로
  assert.equal(at3.findings.find((f) => f.id === 'hooks-missing')?.severity, 'info');

  applyPlan(fakeRepo(name, { pkg: base }), planLevel({ ...fakeRepo(name, { pkg: base }), level: 3 }, 4));
  const at4 = diagnose(scanRepo(name));
  assert.equal(at4.findings.find((f) => f.id === 'hooks-missing'), undefined, 'lefthook.yml 이 생겼다');
  assert.equal(at4.findings.find((f) => f.id === 'hooks-not-installed')?.severity, 'warn', '설치는 아직 안 됐다');
});

test('doctor: verify 가 format:check 를 부르지 않으면 알려준다', () => {
  const pkg = { ...base, scripts: { ...base.scripts, 'format:check': 'prettier --check .', verify: 'npm run lint' } };
  const name = 'e-fmt';
  write(`${name}/package.json`, pkg);
  write(`${name}/kmjharness.json`, { harness: '0.0.1', profile: 'react-vite', level: 4 });
  const f = diagnose(scanRepo(name)).findings.find((x) => x.id === 'format-not-in-verify');
  assert.equal(f?.severity, 'warn');
});

test('.prettierignore 는 없을 때만 만들고, 이미 있으면 건드리지 않는다', () => {
  const made = planLevel(fakeRepo('e-ig1', { pkg: base }), 2).actions.find((a) => a.rel === '.prettierignore');
  assert.equal(made.kind, 'create');
  for (const d of ['dist', 'build', 'coverage']) assert.match(made.after, new RegExp(`^${d}$`, 'm'));

  write('e-ig2/.prettierignore', 'node_modules\ndist\n# 이 레포만의 예외\ngenerated\n');
  const repo = { ...fakeRepo('e-ig2', { pkg: base }), files: fs.readdirSync(path.join(ws, 'e-ig2')) };
  const act = planLevel(repo, 2).actions.find((a) => a.rel === '.prettierignore');
  assert.equal(act, undefined, '이미 있으면 계획에 아예 올리지 않는다');
});

test('doctor: 빌드 산출물이 포맷 대상에서 안 빠지면 알려준다', () => {
  const name = 'e-ig3';
  const pkg = { ...base, scripts: { ...base.scripts, 'format:check': 'prettier --check .' } };
  write(`${name}/package.json`, pkg);
  write(`${name}/kmjharness.json`, { harness: '0.0.1', profile: 'react-vite', level: 2 });
  fs.mkdirSync(path.join(ws, name, 'dist'), { recursive: true });
  write(`${name}/dist/app.js`, 'x');

  const f = () => diagnose(scanRepo(name)).findings.find((x) => x.id === 'prettierignore');
  assert.match(f()?.title ?? '', /dist/, '.prettierignore 가 없으면 알린다');

  write(`${name}/.prettierignore`, 'node_modules\n');
  assert.match(f()?.title ?? '', /dist/, 'dist 가 빠져 있으면 알린다');

  write(`${name}/.prettierignore`, 'node_modules\ndist/\n');
  assert.equal(f(), undefined, 'dist/ 처럼 슬래시가 붙어도 인정한다');
});
