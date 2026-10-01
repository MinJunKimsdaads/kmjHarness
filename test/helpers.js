// 테스트용 임시 워크스페이스. paths.js 가 import 시점에 KMJH_WORKSPACE 를 읽으므로
// 이 파일을 다른 core 모듈보다 먼저 import 해야 한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'kmjh-test-'));
process.env.KMJH_WORKSPACE = ws;

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
