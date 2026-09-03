// 레포의 실제 버전과 toolchain.json의 표준을 비교한다. 대시보드 '툴체인' 표의 데이터 소스.
//
// 두 가지를 조심해서 다룬다.
//  1) 비교 정밀도 — 표준이 `~5.8.0`이면 마이너까지, `^9.0.0`이면 메이저까지 본다.
//     메이저만 보면 TS 5.9 vs ~5.8 같은 실제 문제가 '일치'로 묻힌다.
//  2) '없음'의 의미 — 그 레포가 원래 안 쓰는 패키지를 빨간 '없음'으로 띄우면 소음이 된다.
//     프로파일이 요구하는 것만 없을 때 표시하고, 나머지는 설치된 경우에만 줄을 만든다.
import { toolchain } from './paths.js';

const ROLE = {
  react: '프레임워크', 'react-dom': '프레임워크', next: '프레임워크',
  vite: '빌드', typescript: '언어', eslint: '린트', 'typescript-eslint': '린트',
  prettier: '포맷', vitest: '테스트', tailwindcss: '스타일',
  'react-router-dom': '라우팅', zustand: '상태', electron: '데스크톱',
};

// 프로파일별 '있어야 하는' 패키지. 여기 없는 것은 설치돼 있을 때만 비교한다.
const REQUIRED = {
  'react-vite': ['react', 'react-dom', 'vite', 'typescript', 'eslint', 'prettier', 'vitest'],
  next: ['react', 'react-dom', 'next', 'typescript', 'eslint', 'prettier'],
  'node-service': ['eslint', 'prettier'],
  static: ['eslint', 'prettier'],
  data: [],
  unknown: [],
};

const clean = (r) => String(r || '').replace(/^[\^~>=<\s]+/, '');
const parts = (r) => clean(r).split('.').map((n) => parseInt(n, 10));

// 표준 표기가 요구하는 정밀도로만 비교한다.
function compare(current, standard) {
  const c = parts(current), s = parts(standard);
  if (!Number.isFinite(c[0]) || !Number.isFinite(s[0])) return 'unknown';
  const depth = standard.startsWith('^') ? 1 : standard.startsWith('~') ? 2 : 3;
  for (let i = 0; i < depth; i++) {
    const a = c[i] ?? 0, b = s[i] ?? 0;
    if (a < b) return 'behind';
    if (a > b) return 'ahead';
  }
  return 'ok';
}

export function toolchainRows(repo) {
  const tc = toolchain();
  const deps = { ...(repo.pkg?.dependencies || {}), ...(repo.pkg?.devDependencies || {}) };
  const required = REQUIRED[repo.detectedProfile] ?? [];
  const standards = { ...tc.versions, ...(tc.lintToolchain?.add || {}) };

  const names = new Set([...required, ...Object.keys(deps).filter((n) => n in ROLE)]);
  const rows = [];

  for (const name of names) {
    const current = deps[name] ?? null;
    const standard = standards[name] ?? null;
    let status;
    if (!current) status = 'missing';
    else if (!standard) status = 'extra';
    else status = compare(current, standard);
    rows.push({ name, group: ROLE[name] || '기타', current, standard, status });
  }

  const ORDER = ['프레임워크', '라우팅', '상태', '스타일', '빌드', '언어', '린트', '포맷', '테스트', '데스크톱', '기타'];
  rows.sort((a, b) => {
    const d = ORDER.indexOf(a.group) - ORDER.indexOf(b.group);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });

  // 버전이 아닌 '고정 여부' 항목
  const pin = (name, group, current, standard) =>
    rows.push({ name, group, current, standard, status: !current ? 'missing' : current === standard ? 'ok' : 'behind' });
  pin('Node', '런타임', repo.pkg?.engines?.node ?? (repo.files?.includes('.nvmrc') ? '.nvmrc' : null), tc.node);
  pin('packageManager', '런타임', repo.pkg?.packageManager ?? null, tc.packageManager);

  return rows;
}
