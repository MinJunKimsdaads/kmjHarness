// 하네스 루트와 워크스페이스 루트를 찾는다.
// kmjHarness가 github2/kmjHarness 에 있으므로, 워크스페이스는 그 부모다.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const workspaceRoot = path.dirname(harnessRoot);

export const readJson = (p, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};
export const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
};
export const exists = (p) => fs.existsSync(p);
export const toolchain = () => readJson(path.join(harnessRoot, 'toolchain.json'));
