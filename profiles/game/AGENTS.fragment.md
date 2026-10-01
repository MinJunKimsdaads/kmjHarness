## 스택 규약 (game — react-vite를 물려받음)

- 게임 세계는 **three**로 캔버스 하나에 그린다. React는 그 위의 화면 UI(메뉴·가방·대화·설정)만 맡는다.
- 매 프레임 바뀌는 값(위치·체력 등)을 React 상태로 두지 않는다. UI가 보는 값만 Zustand 스토어로 보낸다.
- 게임 규칙은 `rules/` 에 둔다. 여기서는 React · three · DOM을 import하지 않는다 (ESLint로 막음).
- 규칙은 고정 틱으로 돈다. `Math.random` 대신 시드 난수.
- 화면 전환(시작 → 게임 → 설정)은 React Router.
- 모노레포(pnpm 워크스페이스)에서는 경로 별칭 `@/*` 가 각 패키지 자기 `src/*` 를 가리킨다.
