// plan.js가 만든 계획을 실제로 디스크에 쓴다. 여기 말고는 아무 데서도 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readWorkspace, writeWorkspace, harnessVersion } from './registry.js';
import { managedBlock } from './markers.js';

export const hash = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

// 쓰면 안 되는 상태면 이유를, 아니면 null 을 돌려준다. CLI · 서버 · 대시보드가 같은 판단을 쓴다.
export function applyBlocker(repo) {
  const g = repo.git;
  if (g?.inMerge) {
    return g.conflicted > 0
      ? `머지 충돌 ${g.conflicted}개 파일이 남아 있습니다. 충돌을 해결해 커밋(또는 git merge --abort)한 뒤에 적용하세요.`
      : '병합·리베이스 등이 아직 끝나지 않았습니다. 마무리(커밋 또는 --continue)하거나 --abort 한 뒤에 적용하세요.';
  }
  return null;
}

export class ApplyBlockedError extends Error {
  constructor(message) { super(message); this.code = 'APPLY_BLOCKED'; }
}

export function applyPlan(repo, plan) {
  if (plan.unavailable) throw new Error(plan.reason || '적용할 수 없는 계획입니다');
  // 병합이 끝나지 않은 레포에는 절대 쓰지 않는다 (git 상태를 모르는 레포 객체는 검사하지 않는다)
  const blocked = applyBlocker(repo);
  if (blocked) throw new ApplyBlockedError(blocked);

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
    // managed === 'block' 이면 마커 안쪽만 해시한다 (AGENTS.md 의 사용자 영역은 감시 대상이 아니다).
    if (a.managed === 'block') {
      const blk = managedBlock(a.after);
      if (blk) managed[a.rel] = { hash: hash(blk), scope: 'block' };
    } else if (a.managed) {
      managed[a.rel] = hash(a.after);
    }
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
    profile: repo.profile ?? repo.detectedProfile,
    addons: repo.detectedAddons,
    level: plan.toLevel,
    lastSync: new Date().toISOString(),
  };
  writeWorkspace(ws);
  return { written, removed, registered: repo.name, level: plan.toLevel };
}
