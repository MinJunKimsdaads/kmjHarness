// 양방향 핸드셰이크: 프로젝트의 kmjharness.json ↔ 하네스의 workspace.json (설계서 §2.4)
import path from 'node:path';
import { harnessRoot, workspaceRoot, readJson, writeJson } from './paths.js';

const wsPath = path.join(harnessRoot, 'workspace.json');
export const repoConfigPath = (name) => path.join(workspaceRoot, name, 'kmjharness.json');

export const readWorkspace = () => readJson(wsPath, { harnessVersion: '0.1.0', repos: {} });
export const writeWorkspace = (ws) => writeJson(wsPath, ws);
export const readRepoConfig = (name) => readJson(repoConfigPath(name));

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
