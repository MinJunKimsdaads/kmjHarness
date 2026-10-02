// 워크스페이스(github2)를 스캔해 각 레포의 사실을 수집한다. 쓰기 없음.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { workspaceRoot, harnessRoot, readJson } from './paths.js';
import { detectProfile, detectAddons, detectPackageManager, collectDeps } from './detect.js';
import { profileExists } from './profiles.js';
import { readWorkspace, readRepoConfig, handshake, excludedNames } from './registry.js';

const git = (dir, args) => {
  try {
    // trim()을 쓰면 `git status --porcelain` 첫 줄의 선행 공백(' M')이 날아가 상태 판정이 어긋난다.
    // --no-optional-locks: status 등이 인덱스를 갱신하려고 .git/index.lock 을 만드는 것을 막는다.
    // 읽기만 하는 도구가 잠금 파일을 남기면, 정리에 실패했을 때 사용자의 git 작업이 통째로 막힌다.
    return execFileSync('git', ['--no-optional-locks', '-C', dir, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\s+$/, '');
  } catch { return null; }
};


// `git status --porcelain`의 XY 코드를 사람이 판단할 수 있는 상태로 분류한다.
// 두 가지를 정확히 하려고 경로 단위 집합으로 센다.
//  1) 충돌(U*·AA·DD)은 그냥 "변경"이 아니라 작업을 멈춰야 하는 상태다.
//  2) CRLF/LF 차이만으로 전체 파일이 '변경됨'으로 보이는 오탐을 걸러낸다.
//     (Windows에서 체크아웃한 레포를 다른 환경에서 읽을 때 흔히 발생)
const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const pathOf = (line) => {
  const rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');          // rename: "old -> new"
  return (arrow >= 0 ? rest.slice(arrow + 4) : rest).replace(/^"|"$/g, '');
};

function classifyStatus(dir, statusRaw) {
  const lines = statusRaw ? statusRaw.split('\n').filter(Boolean) : [];
  const conflict = new Set(), untracked = new Set(), staged = new Set(), modified = new Set();
  for (const l of lines) {
    const xy = l.slice(0, 2), file = pathOf(l);
    if (CONFLICT.has(xy)) { conflict.add(file); continue; }
    if (xy === '??') { untracked.add(file); continue; }
    if (xy[0] !== ' ') staged.add(file);
    if (xy[1] === 'M' || xy[1] === 'D') modified.add(file);
  }

  // 줄바꿈만 다른 파일은 numstat에 잡히지 않는다 → 실제로 내용이 바뀐 것만 남는다.
  const numstat = git(dir, ['diff', '--ignore-cr-at-eol', '--numstat']) || '';
  const realModified = new Set(
    numstat.split('\n').filter(Boolean).map((l) => l.split('\t')[2]).filter(Boolean)
  );

  const eolNoise = [...modified].filter((f) => !realModified.has(f)).length;
  const dirtyPaths = new Set([...conflict, ...untracked, ...staged, ...realModified]);

  return {
    conflicted: conflict.size,
    untracked: untracked.size,
    staged: staged.size,
    modified: realModified.size,
    eolNoise,
    eolOnly: dirtyPaths.size === 0 && eolNoise > 0,
    dirty: dirtyPaths.size,
    inMerge: conflict.size > 0,
    summary: git(dir, ['diff', '--ignore-cr-at-eol', '--shortstat']) || null,
  };
}

// git 을 부르지 않는 빠른 부분 — 파일 몇 개만 읽는다. 대시보드 첫 화면(/api/repos)이 이것만 쓴다.
function baseRepo(name, ws = readWorkspace()) {
  const dir = path.join(workspaceRoot, name);
  const files = fs.readdirSync(dir);
  const pkg = readJson(path.join(dir, 'package.json'));
  const hasHtml = files.some((f) => f.endsWith('.html'));
  const hasDataOnly = !pkg && !hasHtml;
  const cfg = readRepoConfig(name);

  // 모노레포면 하위 패키지 의존성까지 합쳐서 판정한다. 아니면 루트 package.json 그대로.
  const { deps, monorepo, packages } = collectDeps(dir, pkg);
  const detectedProfile = detectProfile({ pkg, hasHtml, hasDataOnly, deps });
  // 레포가 kmjharness.json 에 프로파일을 선언했으면 그것이 우선이다.
  // 감지 규칙이 늘어나도(예: game) 이미 편입된 레포의 프로파일이 저절로 바뀌지 않게 하기 위함.
  const profile = cfg?.profile && profileExists(cfg.profile) ? cfg.profile : detectedProfile;

  return {
    name, dir, files, pkg, cfg, deps, monorepo, packages, detectedProfile, profile,
    isGitRepo: files.includes('.git'),
    excluded: excludedNames(ws).includes(name),
    handshake: handshake(name, cfg, ws),
  };
}

// 대시보드 목록용 요약. git · 진단 · 의존성 설치 상태는 없다 (그건 레포 하나씩 따로 읽는다).
export function quickRepo(name, ws = readWorkspace()) {
  const b = baseRepo(name, ws);
  return {
    name,
    level: b.cfg?.level ?? null,
    profile: b.profile,
    detectedProfile: b.detectedProfile,
    addons: detectAddons({ pkg: b.pkg, deps: b.deps }),
    packageManager: detectPackageManager(b.files),
    hasPackageJson: Boolean(b.pkg),
    isGitRepo: b.isGitRepo,
    monorepo: b.monorepo,
    handshake: b.handshake,
    excluded: b.excluded,
  };
}

export function scanRepo(name) {
  const { dir, files, pkg, cfg, deps, monorepo, packages, detectedProfile, profile, isGitRepo, excluded, handshake: hs } = baseRepo(name);

  const branch = git(dir, ['branch', '--show-current']);
  const statusRaw = git(dir, ['status', '--porcelain']);
  const lastCommit = git(dir, ['log', '-1', '--format=%h %s (%cr)']);
  const remote = git(dir, ['remote', 'get-url', 'origin']);
  const gitState = classifyStatus(dir, statusRaw);

  return {
    name, dir,
    isGitRepo,
    remote,
    branch,
    lastCommit,
    git: gitState,
    dirtyCount: gitState.dirty,      // UI 호환용 요약값
    eolArtifact: gitState.eolOnly,
    pkg,
    detectedProfile,
    profile,
    deps,
    monorepo,
    workspacePackages: packages,
    detectedAddons: detectAddons({ pkg, deps }),
    packageManager: detectPackageManager(files),
    files,
    config: cfg,
    level: cfg?.level ?? null,
    handshake: hs,
    excluded,
  };
}

// 워크스페이스의 레포 폴더 이름들. 하네스 자신과 숨김 폴더, node_modules 는 뺀다.
export function listRepoNames() {
  const harnessName = path.basename(harnessRoot);
  return fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== harnessName && e.name !== 'node_modules')
    .map((e) => e.name)
    .sort();
}

// 제외한 폴더도 포함해 모두 돌려준다 (각 레포의 excluded 로 구분). 숨길지는 호출하는 쪽이 정한다.
export function scanWorkspace() {
  return listRepoNames().map(scanRepo);
}

export function quickScanWorkspace() {
  const ws = readWorkspace();
  return listRepoNames().map((n) => quickRepo(n, ws));
}
