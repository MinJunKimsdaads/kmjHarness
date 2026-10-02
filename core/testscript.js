// package.json 의 test 스크립트가 watch 모드인지 판단하고, 1회 실행으로 바꾼 명령을 만든다.
// watch 모드면 verify 가 CI에서 영원히 멈추므로 L2가 고친다.
//
// 아는 러너만 고친다. 모르는 러너(node --test, mocha, ava …)는 건드리지 않는다
// — 예전에는 첫 단어 뒤에 무조건 'run' 을 끼워 "node run --test" 같은 명령을 만들었다.
//   vitest            → vitest run           (vitest 기본값이 watch)
//   vitest watch|dev  → vitest run
//   vitest --watch|-w → vitest run           (다른 인자는 그대로)
//   vitest run / --run → 그대로
//   jest --watch(All) → jest                 (jest 기본값은 1회 실행)
//   mocha --watch|-w  → mocha                (mocha 기본값은 1회 실행)
//   react-scripts test → 그대로 (CI 환경변수가 없으면 watch 로 돈다 — doctor 가 info 로만 알린다)
const tokens = (cmd) => String(cmd || '').trim().split(/\s+/).filter(Boolean);

const isBin = (x, name) => x === name || x.endsWith(`/${name}`);
const WATCH_FLAGS = { vitest: ['--watch', '-w'], jest: ['--watch', '--watchAll'], mocha: ['--watch', '-w'] };

export function testRunner(cmd) {
  const t = tokens(cmd);
  if (t.some((x) => isBin(x, 'vitest'))) return 'vitest';
  if (t.some((x) => isBin(x, 'jest'))) return 'jest';
  if (t.some((x) => isBin(x, 'mocha'))) return 'mocha';
  if (t.some((x, i) => isBin(x, 'react-scripts') && t[i + 1] === 'test')) return 'react-scripts';
  return t.length ? 'other' : null;
}

// watch 모드면 1회 실행 명령을, 아니면 null 을 돌려준다.
export function oneShotTest(cmd) {
  const runner = testRunner(cmd);
  const all = tokens(cmd);
  const flags = WATCH_FLAGS[runner] || [];
  const t = all.filter((x) => !flags.includes(x));
  const droppedFlag = t.length !== all.length;
  if (runner === 'vitest') {
    const i = t.findIndex((x) => isBin(x, 'vitest'));
    const sub = t[i + 1];
    if (t.includes('--run') || sub === 'run') return droppedFlag ? t.join(' ') : null;
    if (sub === 'watch' || sub === 'dev') { t[i + 1] = 'run'; return t.join(' '); }
    // 첫 단어가 vitest 이고 뗀 플래그가 없으면 예전과 같은 결과가 나오도록 원래 문자열에 끼워 넣는다
    if (i === 0 && !droppedFlag) return String(cmd).trim().replace(/^(\S+)/, '$1 run');
    t.splice(i + 1, 0, 'run');
    return t.join(' ');
  }
  if (runner === 'jest' || runner === 'mocha') return droppedFlag ? t.join(' ') : null;
  return null;
}
