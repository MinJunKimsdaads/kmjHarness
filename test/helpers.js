// 테스트용 임시 워크스페이스. paths.js 가 import 시점에 KMJH_WORKSPACE 를 읽으므로
// 이 파일을 다른 core 모듈보다 먼저 import 해야 한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'kmjh-test-'));
process.env.KMJH_WORKSPACE = ws;
// 진짜 kmjHarness/workspace.json 을 건드리지 않도록 레지스트리도 임시 폴더로 (파일이라 레포로 잡히지 않는다)
process.env.KMJH_REGISTRY = path.join(ws, 'workspace.json');

export function write(rel, content) {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return abs;
}

// planLevel 이 받는 모양의 레포 객체를 만든다 (scan 없이)
export function fakeRepo(name, { pkg = null, config = null, detectedProfile = 'react-vite', profile } = {}) {
  const dir = path.join(ws, name);
  fs.mkdirSync(dir, { recursive: true });
  if (pkg) write(`${name}/package.json`, pkg);
  return {
    name, dir, pkg, config, level: config?.level ?? null,
    packageManager: 'pnpm', detectedProfile, profile: profile ?? detectedProfile,
    detectedAddons: [], files: fs.readdirSync(dir),
  };
}

// 테스트가 끝나면 임시 워크스페이스를 지운다
process.on('exit', () => { try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* 이미 없음 */ } });

// 테스트용 git — 사용자 설정과 무관하게 동작하도록 이름·메일·기본 브랜치를 고정한다
export function git(rel, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main',
    '-c', 'commit.gpgsign=false', '-C', path.join(ws, rel), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// 충돌 파일 하나가 남은 병합 상태의 레포를 만든다
export function mergeConflictRepo(rel) {
  write(`${rel}/a.txt`, 'base\n');
  git(rel, 'init', '-q');
  git(rel, 'add', '-A'); git(rel, 'commit', '-qm', 'base');
  git(rel, 'checkout', '-qb', 'other');
  write(`${rel}/a.txt`, 'other\n'); git(rel, 'commit', '-qam', 'other');
  git(rel, 'checkout', '-q', 'main');
  write(`${rel}/a.txt`, 'mine\n'); git(rel, 'commit', '-qam', 'mine');
  try { git(rel, 'merge', 'other'); } catch { /* 충돌로 실패하는 게 정상 */ }
}
