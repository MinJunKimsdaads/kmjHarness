// package.json이 선언한 버전과 node_modules에 실제로 설치된 버전을 비교한다.
// "적용은 했는데 install을 안 해서 verify가 깨지는" 상황을 상태 기록 없이 감지하기 위한 것.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './paths.js';

const major = (r) => { const n = parseInt(String(r || '').replace(/^[\^~>=<\s]+/, '').split('.')[0], 10); return Number.isFinite(n) ? n : null; };

export function staleDeps(repo) {
  const declared = { ...(repo.pkg?.dependencies || {}), ...(repo.pkg?.devDependencies || {}) };
  const stale = [];
  const missing = [];

  for (const [name, range] of Object.entries(declared)) {
    if (range.startsWith('workspace:') || range.startsWith('file:') || range.startsWith('link:')) continue;
    const entry = path.join(repo.dir, 'node_modules', name);
    const installed = readJson(path.join(entry, 'package.json'));
    if (!installed) {
      // pnpm은 node_modules에 심볼릭 링크/정션을 만든다. 링크를 따라갈 수 없는 환경에서는
      // 내용을 못 읽을 뿐 설치는 되어 있다. 항목 자체가 없을 때만 '미설치'로 본다.
      let entryExists = false;
      try { fs.lstatSync(entry); entryExists = true; } catch { /* 정말 없음 */ }
      if (!entryExists) missing.push(name);
      continue;
    }
    const a = major(installed.version), b = major(range);
    if (a != null && b != null && a !== b) stale.push(`${name} (선언 ${range} / 설치 ${installed.version})`);
  }
  return { stale, missing, needsInstall: stale.length > 0 || missing.length > 0 };
}
