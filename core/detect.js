// package.json 지문으로 프로파일을 자동 감지한다. (설계서 §2.5)
export function detectProfile({ pkg, hasHtml, hasDataOnly }) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);

  if (!pkg) return hasHtml ? 'static' : hasDataOnly ? 'data' : 'unknown';
  if (has('next')) return 'next';
  if (has('react') && (has('vite') || has('@vitejs/plugin-react'))) return 'react-vite';
  if (has('react')) return 'react-legacy';
  const frontend = ['react', 'vue', 'svelte', 'next', 'vite', '@angular/core'];
  if (!frontend.some(has)) return 'node-service';
  return 'unknown';
}

export function detectAddons({ pkg }) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
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
