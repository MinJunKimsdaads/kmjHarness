// AGENTS.md 의 관리 블록 마커. plan(쓰기) · apply(해시) · doctor(감시)가 같은 정의를 써야 하므로
// 한 곳에 둔다 — 세 곳에 복사하면 마커를 바꿀 때 한 곳을 빠뜨린다.
export const BEGIN = '<!-- kmjharness:begin — kmjh가 관리합니다. 직접 수정하지 마세요 -->';
export const END = '<!-- kmjharness:end -->';

// 관리 블록만 떼어낸다 (마커 포함). 블록이 없으면 null.
// AGENTS.md 는 마커 바깥이 사용자 영역이라 파일 전체를 해시하면 매번 drift 로 잡힌다.
export function managedBlock(text) {
  const s = String(text ?? '');
  const i = s.indexOf(BEGIN);
  const j = s.indexOf(END);
  if (i < 0 || j < 0 || j < i) return null;
  return s.slice(i, j + END.length);
}
