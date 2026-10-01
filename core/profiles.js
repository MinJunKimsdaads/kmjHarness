// 프로파일 상속과 바깥 층(layers).
//
// 프로파일 상속 — profiles/<이름>/profile.json 에 { "extends": "부모" } 를 두면
//   AGENTS 조각은 조상부터 차례로 이어 붙이고 (부모 규칙 + 내 규칙),
//   ESLint 같은 파일은 가까운 쪽(자식)을 먼저 찾고 없으면 부모 것을 쓴다.
//   profile.json 이 없는 프로파일은 지금까지와 똑같이 자기 자신만 본다.
//
// 바깥 층 — 레포의 kmjharness.json 에 "layers" 를 적으면, 하네스 밖의 폴더
//   (예: ../kmjHackNSlash/harness) 에 있는 AGENTS.fragment.md 를 관리 블록 끝에 붙인다.
//   kmjHarness → 프로파일 → 바깥 층 순서로, 위층 규칙을 아래층이 덧붙이는 구조다.
import fs from 'node:fs';
import path from 'node:path';
import { harnessRoot, workspaceRoot, readJson } from './paths.js';

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

export const profileExists = (name) =>
  Boolean(name) && fs.existsSync(path.join(harnessRoot, 'profiles', name));

// [자기, 부모, 조부모 …]. 순환이나 없는 부모를 만나면 거기서 멈춘다.
export function profileChain(name) {
  const chain = [];
  let cur = name;
  while (cur && !chain.includes(cur)) {
    chain.push(cur);
    cur = readJson(path.join(harnessRoot, 'profiles', cur, 'profile.json'), {})?.extends ?? null;
    if (cur && !profileExists(cur)) break;
  }
  return chain;
}

// 가장 가까운 프로파일의 파일. 자식에 없으면 부모에서 찾는다.
export function profileFile(name, file) {
  for (const p of profileChain(name)) {
    const t = read(path.join(harnessRoot, 'profiles', p, file));
    if (t !== null) return t;
  }
  return null;
}

// 조상 → 자손 순으로 AGENTS 조각을 잇는다.
export function profileFragments(name) {
  return profileChain(name).reverse()
    .map((p) => read(path.join(harnessRoot, 'profiles', p, 'AGENTS.fragment.md')))
    .filter((t) => t && t.trim())
    .map((t) => t.trim())
    .join('\n\n');
}

// kmjharness.json 의 layers 를 해석한다. 두 가지 모양을 받는다.
//   "layers": ["kmjHackNSlash/harness"]                         ← 워크스페이스(github2) 기준 경로
//   "layers": [{ "name": "hacknslash", "from": "../kmjHackNSlash/harness" }]  ← 레포 폴더 기준 경로
// 어느 쪽이든 워크스페이스 밖을 가리키면 거부한다.
// 층 폴더에는 AGENTS.fragment.md 가 꼭 있어야 하고, layer.json(이름·버전)과
// toolchain.json(이 층이 더하는 버전 표준)은 있으면 읽는다.
export function resolveLayers(repo) {
  const list = Array.isArray(repo.config?.layers) ? repo.config.layers : [];
  return list.map((l) => {
    const isStr = typeof l === 'string';
    const from = String(isStr ? l : l?.from || '').trim();
    let name = String(isStr ? '' : l?.name || '').trim();
    if (!from) return { name: name || '?', from, ok: false, problem: '경로(from)가 비어 있습니다' };
    const dir = isStr ? path.resolve(workspaceRoot, from) : path.resolve(repo.dir, from);
    const rel = path.relative(workspaceRoot, dir);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { name: name || from, from, dir, ok: false, problem: '워크스페이스 밖을 가리킵니다' };
    }
    const meta = readJson(path.join(dir, 'layer.json'), {}) || {};
    name = name || meta.name || rel.replaceAll('\\', '/');
    const fragment = read(path.join(dir, 'AGENTS.fragment.md'));
    if (fragment === null) return { name, from, dir, ok: false, problem: `${from}/AGENTS.fragment.md 가 없습니다` };
    const tc = readJson(path.join(dir, 'toolchain.json'), {}) || {};
    return { name, from, dir, ok: true, fragment: fragment.trim(), version: meta.version ?? null, versions: tc.versions || {} };
  });
}
