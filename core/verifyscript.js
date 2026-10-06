// verify 스크립트에 조각을 '끼워 넣는다'. 다시 만들지 않는 이유:
// 레포가 자기 스텝을 더해 둔 경우가 있다 (예: "pnpm framework:check && pnpm lint && ...").
// 통째로 재생성하면 그 스텝이 사라진다 — 기존 것을 보존하면서 더하는 게 이 하네스의 규칙이다.

const SEP = ' && ';
const callOf = (pm, script) => (pm === 'npm' || pm === 'none' ? `npm run ${script}` : `${pm} ${script}`);

// verify 안에서 그 스크립트를 부르는 조각이 있는가
const callsScript = (part, script) =>
  new RegExp(`(^|\\s)(run\\s+)?${script.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(\\s|$)`).test(part.trim());

export function hasStep(verify, script) {
  return String(verify || '').split(SEP).some((p) => callsScript(p, script));
}

// script 를 before 앞에 끼워 넣는다. before 가 없으면 맨 뒤에.
// 이미 있으면 원래 문자열을 그대로 돌려준다.
export function insertStep(verify, { pm, script, before }) {
  const cur = String(verify || '').trim();
  if (!cur) return callOf(pm, script);
  if (hasStep(cur, script)) return cur;

  const parts = cur.split(SEP);
  const at = before ? parts.findIndex((p) => callsScript(p, before)) : -1;
  const piece = callOf(pm, script);
  if (at < 0) parts.push(piece);
  else parts.splice(at, 0, piece);
  return parts.join(SEP);
}
