## 스택 규약 (react-vite)

- 상태 관리는 **Zustand**. Redux · Context 기반 전역 상태 도입 금지.
- 라우팅은 **React Router 7**.
- 스타일은 **Tailwind**. 새 `.scss` 파일 생성 금지 — 서드파티 위젯 오버라이드는 `src/styles/vendor/` 안에서만 허용.
- 테스트는 **Vitest + Testing Library**, 파일명은 `*.test.ts(x)`.
- 경로 별칭 `@/*` → `src/*`.
