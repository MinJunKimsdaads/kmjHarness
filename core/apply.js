// plan.js가 만든 계획을 실제로 디스크에 쓴다. 여기 말고는 아무 데서도 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readWorkspace, writeWorkspace, harnessVersion } from './registry.js';

export const hash = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

export function applyPlan(repo, plan) {
  if (plan.unavailable) throw new Error(plan.reason || '적용할 수 없는 계획입니다');

  const written = [];
  const managed = {};

  const removed = [];
  for (const a of plan.actions) {
    // 하네스가 대체하는 옛 설정 파일 삭제 (supersedes 목록에 있는 것만 여기 온다)
    if (a.remove) {
      try { fs.rmSync(path.join(repo.dir, a.rel), { force: true }); removed.push(a.rel); } catch { /* 이미 없음 */ }
      continue;
    }
    if (a.after == null) continue;
    // 건너뛴(이미 동일한) 관리 파일도 해시는 기록해야 이후 drift 감지가 성립한다.
    if (a.managed) managed[a.rel] = hash(a.after);
    if (a.kind === 'skip') continue;
    const abs = path.join(repo.dir, a.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, a.after, 'utf8');
    written.push(a.rel);
  }

  // 관리 파일 목록과 해시를 남긴다 → 손으로 고치면 doctor가 drift로 잡아낸다.
  if (Object.keys(managed).length) {
    const mPath = path.join(repo.dir, '.kmjharness', 'manifest.json');
    fs.mkdirSync(path.dirname(mPath), { recursive: true });
    fs.writeFileSync(mPath, JSON.stringify({
      $comment: 'kmjh가 생성했습니다. 관리 파일의 해시 — 직접 수정하지 마세요.',
      harness: harnessVersion(),
      level: plan.toLevel,
      appliedAt: new Date().toISOString(),
      files: managed,
    }, null, 2) + '\n', 'utf8');
    written.push('.kmjharness/manifest.json');
  }

  // 하네스 측 레지스트리 갱신 (핸드셰이크 반대편)
  const ws = readWorkspace();
  ws.harnessVersion = harnessVersion();
  ws.repos = ws.repos || {};
  ws.repos[repo.name] = {
    profile: repo.detectedProfile,
    addons: repo.detectedAddons,
    level: plan.toLevel,
    lastSync: new Date().toISOString(),
  };
  writeWorkspace(ws);
  return { written, removed, registered: repo.name, level: plan.toLevel };
}
