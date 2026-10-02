// 양방향 핸드셰이크: 프로젝트의 kmjharness.json ↔ 하네스의 workspace.json (설계서 §2.4)
import path from 'node:path';
import { harnessRoot, workspaceRoot, readJson, writeJson } from './paths.js';

// KMJH_REGISTRY: 테스트·시험용 워크스페이스에서 진짜 workspace.json 을 건드리지 않으려고 쓴다. 평소엔 비워 둔다.
const wsPath = process.env.KMJH_REGISTRY
  ? path.resolve(process.env.KMJH_REGISTRY)
  : path.join(harnessRoot, 'workspace.json');
export const repoConfigPath = (name) => path.join(workspaceRoot, name, 'kmjharness.json');

export const readWorkspace = () => readJson(wsPath, { harnessVersion: '0.1.0', repos: {} });
export const writeWorkspace = (ws) => writeJson(wsPath, ws);
export const readRepoConfig = (name) => readJson(repoConfigPath(name));

// ── 제외 목록 ───────────────────────────────────────────────
// 이 머신에서 하네스를 적용하지 않을 폴더 (데이터 폴더, 남의 레포 등).
// workspace.json 의 "exclude" 에 둔다 — workspace.json 은 머신마다 다르므로 커밋하지 않는다.
// scan · apply 는 workspace.json 을 읽어 고친 뒤 통째로 다시 쓰므로 이 키를 그대로 보존한다.
export const excludedNames = (ws = readWorkspace()) =>
  Array.isArray(ws.exclude) ? ws.exclude.filter((n) => typeof n === 'string') : [];

export function setExcluded(name, excluded) {
  const ws = readWorkspace();
  const cur = new Set(excludedNames(ws));
  if (excluded) cur.add(name); else cur.delete(name);
  ws.exclude = [...cur].sort();
  writeWorkspace(ws);
  return ws.exclude;
}

export function harnessVersion() {
  return readJson(path.join(harnessRoot, 'package.json'), {}).version ?? '0.0.0';
}

// 핸드셰이크 상태 판정
export function handshake(name, repoCfg, ws) {
  const inWs = Boolean(ws.repos?.[name]);
  const inRepo = Boolean(repoCfg);
  if (!inWs && !inRepo) return { state: 'unmanaged', label: '미편입' };
  if (inWs && !inRepo) return { state: 'orphan-ws', label: '레포 쪽 선언 누락' };
  if (!inWs && inRepo) return { state: 'orphan-repo', label: '하네스 레지스트리 누락' };
  if (repoCfg.harness !== harnessVersion()) return { state: 'stale', label: '하네스 버전 지연' };
  return { state: 'linked', label: '연결됨' };
}
