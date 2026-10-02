// "3시간 전" 같은 한국어 경과 시간. CLI · doctor 가 쓴다 (대시보드는 같은 규칙을 ui/index.html 에 따로 둔다).
export function agoKo(ms, now = Date.now()) {
  if (ms == null) return null;
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
