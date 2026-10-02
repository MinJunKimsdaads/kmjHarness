// package.json 의 test 스크립트가 watch 모드인지 판단하고, 1회 실행으로 바꾼 명령을 만든다.
// watch 모드면 verify 가 CI에서 영원히 멈추므로 L2가 고친다.
//
// 아는 러너만 고친다. 모르는 러너(node --test, mocha, ava …)는 건드리지 않는다
// — 예전에는 첫 단어 뒤에 무조건 'run' 을 끼워 "node run --test" 같은 명령을 만들었다.
//   vitest            → vitest run           (vitest 기본값이 watch)
//   vitest watch|dev  → vitest run
//   vitest run / --run → 그대로
//   jest --watch(All) → jest                 (jest 기본값은 1회 실행)
const tokens = (cmd) => String(cmd || '').trim().split(/\s+/).filter(Boolean);

export function testRunner(cmd) {
  const t = tokens(cmd);
  if (t.some((x) => x === 'vitest' || x.endsWith('/vitest'))) return 'vitest';
  if (t.some((x) => x === 'jest' || x.endsWith('/jest'))) return 'jest';
  return t.length ? 'other' : null;
}

// watch 모드면 1회 실행 명령을, 아니면 null 을 돌려준다.
export function oneShotTest(cmd) {
  const runner = testRunner(cmd);
  const t = tokens(cmd);
  if (runner === 'vitest') {
    if (t.includes('--run')) return null;
    const i = t.findIndex((x) => x === 'vitest' || x.endsWith('/vitest'));
    const sub = t[i + 1];
    if (sub === 'run') return null;
    if (sub === 'watch' || sub === 'dev') { t[i + 1] = 'run'; return t.join(' '); }
    // 첫 단어가 vitest 면 예전과 같은 결과가 나오도록 원래 문자열에 끼워 넣는다
    if (i === 0) return String(cmd).trim().replace(/^(\S+)/, '$1 run');
    t.splice(i + 1, 0, 'run');
    return t.join(' ');
  }
  if (runner === 'jest') {
    if (!t.some((x) => x === '--watch' || x === '--watchAll')) return null;
    return t.filter((x) => x !== '--watch' && x !== '--watchAll').join(' ');
  }
  return null;
}
