## 스택 규약 (static — 마이그레이션 대상)

- 이 레포는 표준 스택으로 이관 중이다. `MIGRATION.md`의 체크리스트를 따를 것.
- **새 코드에 jQuery를 쓰지 말 것.** 기존 jQuery 코드는 `src/legacy/` 안에서만 유지된다.
- 새로 작성하는 화면은 React + Zustand + Tailwind로 만든다.
