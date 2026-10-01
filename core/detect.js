// package.json 지문으로 프로파일을 자동 감지한다. (설계서 §2.5)
import fs from 'node:fs';
import path from 'node:path';

const depsOf = (pkg) => ({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) });

// deps 를 넘기면 그것으로 판정한다 (모노레포는 하위 패키지까지 합친 목록을 넘긴다).
export function detectProfile({ pkg, hasHtml, hasDataOnly, deps: given }) {
  const deps = given || depsOf(pkg);
  const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);

  if (!pkg) return hasHtml ? 'static' : hasDataOnly ? 'data' : 'unknown';
  if (has('next')) return 'next';
  const viteReact = has('react') && (has('vite') || has('@vitejs/plugin-react'));
  if (viteReact && has('three')) return 'game';        // three 캔버스 + React UI
  if (viteReact) return 'react-vite';
  if (has('react')) return 'react-legacy';
  const frontend = ['react', 'vue', 'svelte', 'next', 'vite', '@angular/core'];
  if (!frontend.some(has)) return 'node-service';
  return 'unknown';
}

export function detectAddons({ pkg, deps: given }) {
  const deps = given || depsOf(pkg);
  const addons = [];
  if ('electron' in deps || 'electron-builder' in deps) addons.push('electron');
  return addons;
}

export function detectPackageManager(files) {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  if (files.includes('bun.lockb')) return 'bun';
  if (files.includes('package-lock.json')) return 'npm';
  return 'none';
}

// ── 모노레포 ────────────────────────────────────────────────
// pnpm-workspace.yaml 의 packages 목록, 또는 package.json 의 workspaces 에서 패턴을 읽는다.
// YAML 라이브러리 없이 읽을 수 있는 단순한 형태만 다룬다:
//   packages:
//     - 'packages/*'
//     - games/sample
export function workspacePatterns(dir, pkg) {
  const yaml = (() => { try { return fs.readFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'utf8'); } catch { return null; } })();
  if (yaml !== null) {
    const out = [];
    let inPackages = false;
    for (const raw of yaml.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '');
      if (/^\S/.test(line)) { inPackages = /^packages\s*:/.test(line); continue; }
      const m = inPackages && line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
      if (m) out.push(m[1]);
    }
    return out;
  }
  const ws = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  return Array.isArray(ws) ? ws : [];
}

// 'a/*' 와 'a/b' 형태만 펼친다. '!' 로 시작하는 제외 패턴은 무시한다.
export function workspacePackageDirs(dir, patterns) {
  const dirs = [];
  for (const pat of patterns) {
    if (pat.startsWith('!')) continue;
    const clean = pat.replace(/\/+$/, '');
    if (clean.endsWith('/*') && !clean.slice(0, -2).includes('*')) {
      const base = path.join(dir, clean.slice(0, -2));
      let ents = [];
      try { ents = fs.readdirSync(base, { withFileTypes: true }); } catch { /* 없음 */ }
      for (const e of ents) if (e.isDirectory()) dirs.push(path.join(base, e.name));
    } else if (!clean.includes('*')) {
      dirs.push(path.join(dir, clean));
    }
  }
  return dirs.filter((d) => fs.existsSync(path.join(d, 'package.json'))).sort();
}

// 루트 + 하위 패키지의 의존성을 합친다. 모노레포가 아니면 루트 것만 돌려준다.
export function collectDeps(dir, pkg) {
  const patterns = pkg ? workspacePatterns(dir, pkg) : [];
  const dirs = workspacePackageDirs(dir, patterns);
  const deps = { ...depsOf(pkg) };
  for (const d of dirs) {
    let sub = null;
    try { sub = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')); } catch { continue; }
    for (const [n, v] of Object.entries(depsOf(sub))) {
      if (String(v).startsWith('workspace:')) continue;   // 내부 패키지끼리의 참조
      if (!(n in deps)) deps[n] = v;                     // 루트 선언이 우선
    }
  }
  return { deps, monorepo: dirs.length > 0, packages: dirs.map((d) => path.relative(dir, d).replaceAll('\\', '/')) };
}
