# kmjHarness

> 모든 레포가 같은 방식으로 개발되게 만드는 하네스.
> `kmjh` CLI와 로컬 대시보드로 표준을 배포하고, 레포마다 `verify` 한 줄로 검증합니다.

React 레포, Next 레포, Node 서비스, 바닐라 HTML 프로젝트가 뒤섞여 있어도
**어느 레포를 열든 명령어와 규칙이 같아지도록** 만드는 것이 목적입니다.

```
github2/
├─ kmjHarness/        ← 표준의 단일 출처 (이 레포)
├─ age-of-sail/       ← React + Electron
├─ flight-plan/       ← React + OpenLayers
├─ resume/            ← Next.js
└─ opensky-scheduler/ ← Node 배치
```

---

## 핵심 아이디어

### 1. `verify` 하나로 통일한다

스택이 무엇이든 모든 레포가 같은 이름의 스크립트를 갖습니다.

```bash
pnpm verify     # = lint && typecheck && test && build
```

CI도, git 훅도, AI 에이전트도 이 이름만 알면 됩니다.
새 스택이 추가돼도 그것들은 고칠 필요가 없습니다.

### 2. 표준은 한 번에 밀지 않는다 — 편입 레벨

새 레포를 곧바로 100% 표준으로 맞추면 린트 에러가 수백 개 쏟아지고 하루가 날아갑니다.
그래서 **L0부터 한 칸씩** 올립니다.

| 레벨 | 하는 일 | 깨질 위험 |
|---|---|---|
| **L0** 관찰 | 등록만. 파일을 건드리지 않고 진단만 | 없음 |
| **L1** 기본 | `AGENTS.md` · `.editorconfig` · `.claude/` · 검증 워크플로(경고 모드) | 없음 |
| **L2** 계약 | 스크립트 계약(`verify`) · Prettier · 줄바꿈 정규화 · 워크플로 차단 모드 | 낮음 |
| **L3** 린트 | ESLint 9 flat config 통일 · 린트 툴체인 상향 | 중간 |
| **L4** 완전 | 툴체인 버전까지 완전 일치 (React 19 · Node 22 · pnpm) | 높음 |

레벨은 건너뛸 수 없습니다. 각 레포는 자기 속도로 올라갑니다.

### 3. 문서는 부탁, 설정은 규칙, 훅은 강제

`AGENTS.md`에 "커밋 전 verify"라고 써도 지켜진다는 보장은 없습니다.
반드시 지켜져야 하는 것은 git 훅과 CI로 내립니다.

### 4. 단일 출처는 복사하지 않는다

복사하는 순간 진실이 N개가 됩니다. 복사할 것은 *틀*(템플릿·명령·스키마)이고,
복사하면 안 되는 것은 *내용*입니다.
단, **빌드와 CI가 실제로 쓰는 설정은 예외** — GitHub 러너에는 이 레포가 없으므로
`.kmjharness/` 로 각 레포에 벤더링합니다.

---

## 시작하기

의존성이 없습니다. **Node 20 이상만 있으면 됩니다.**

```bash
git clone https://github.com/MinJunKimsdaads/kmjHarness.git
cd kmjHarness
node cli/index.js scan        # 형제 폴더의 레포를 훑어 레지스트리 생성
node cli/index.js dashboard   # → http://127.0.0.1:4321
```

이 레포는 **관리 대상 레포들과 같은 폴더에 두어야 합니다.** 부모 폴더를 워크스페이스로 봅니다.

### 대시보드

첫 화면은 **현황** 탭 하나로 전체 상태를 봅니다. 목록은 바로 뜨고, 레포별 상태(git · 진단 · 의존성)는 몇 개씩 나눠 읽으며 채워집니다.

- **레포마다 한 줄** — 레벨 막대(L0~L4), 상태 점, **지금 할 일** 하나, 버튼 하나
- **지금 할 일** — 막힘(머지 충돌 · 금지 의존성) → 먼저(설치 · 커밋 · 표준 재적용) → 다음 단계(한 레벨 올리기) → 완료. `kmjh list` 와 같은 계산(`core/steps.js` 의 `nowTask`)입니다
- **버튼 하나로 끝까지** — 누르면 바뀔 파일 목록이 먼저 나오고, **[적용하고 확인]**을 눌러야만 *적용 → install → verify* 가 차례로 돌아갑니다. 실패하면 거기서 멈추고 로그 끝부분을 보여줍니다
- **줄을 누르면 펼침** — 지금 할 일 / 나중에(레벨을 올리면 해결되는 것, 접힘) / 참고(접힘), 순서, 버전 비교
- **폴더 제외** — 하네스가 필요 없는 폴더는 펼친 뒤 [이 폴더 제외]. 이 머신의 `workspace.json` 에만 적힙니다
- **설명서** 탭 — 원칙 · 표준 버전 · 레벨 상세 · 명령어 · 파일 소유권 · 용어 · FAQ

머지 충돌 중인 레포에는 적용 버튼이 없고, 서버도 적용을 거부합니다.

### CLI

대시보드와 완전히 같은 로직(`core/`)을 씁니다.

```bash
node cli/index.js list                        # 레포 목록 · 편입 상태 · 지금 할 일
node cli/index.js doctor [repo] [--json]      # 진단 (쓰기 없음)
node cli/index.js plan <repo> --to 2          # 무엇이 바뀔지 미리보기
node cli/index.js promote <repo> --to 2 --apply
node cli/index.js scan                        # 레지스트리 재생성
node cli/index.js exclude <repo>              # 이 머신에서 그 폴더를 목록에서 빼기 (include 로 되돌림)
node cli/index.js levels                      # 편입 레벨 설명
```

`npm link` 하면 `kmjh` 로 줄여 쓸 수 있습니다.
`npm run dashboard:watch` 는 `core/` 수정 시 서버를 자동 재시작합니다.

---

## 구조

```
core/        순수 로직. CLI와 UI가 공유하는 유일한 진실
  paths        하네스/워크스페이스 경로
  detect       package.json 지문 → 프로파일 판별 (모노레포는 하위 패키지까지)
  profiles     프로파일 상속(extends) · 바깥 층(layers)
  scan         레포 스캔 + git 상태 분류
  doctor       진단 규칙 (쓰기 없음)
  levels       편입 레벨 L0~L4 정의
  plan         레벨별 변경 계획 — dry-run 전용, 절대 쓰지 않음
  apply        계획을 실제로 디스크에 쓰는 유일한 곳
  registry     양방향 핸드셰이크
  deps         선언 ≠ 설치 감지
  versions     툴체인 버전 비교
  steps        "지금 뭘 눌러야 하는가" 계산 (nowTask — 대시보드와 list 공용)
  run          install / verify 실행기
cli/         터미널 인터페이스
server/      로컬 API (127.0.0.1 전용) + UI 서빙
ui/          대시보드 — 의존성 0인 단일 HTML
profiles/    프로파일별 템플릿
  base · react-vite · game(react-vite 상속) · next · node-service · static · data
  addons/ electron · release
toolchain.json   모든 툴체인 버전을 여기서만 관리
docs/            ADR · 학습 문서 · CI 이관 가이드
test/            자체 테스트 (node --test, 의존성 없음)
```

### 각 레포에 심어지는 것

```
your-repo/
├─ .kmjharness/            kmjh 소유. 직접 편집 금지
│  ├─ eslint.config.js       공용 flat config
│  └─ manifest.json          관리 파일 해시 (drift 감지용)
├─ .claude/settings.json   ../kmjHarness 참조 선언
├─ .github/workflows/
│  ├─ ci.yml                 당신 것 — 하네스가 절대 건드리지 않음
│  └─ kmjh-verify.yml        하네스 것 — 이름이 달라 충돌 없음
├─ kmjharness.json         핸드셰이크: 프로파일 · 레벨 · 애드온
├─ AGENTS.md               마커 안쪽은 kmjh, 바깥은 당신
└─ CLAUDE.md               "@AGENTS.md" 한 줄
```

---

## 층 쌓기 — 프로파일 상속과 바깥 층

규칙은 위에서 아래로 물려받습니다. 아래 층은 위 층의 언어·프레임워크·버전을 그대로 따르고 자기 규칙만 더합니다.

```
kmjHarness base  →  react-vite  →  game  →  (바깥 층) hacknslash  →  각 게임 레포
     공통 규약        React 스택     three 캔버스      kmjHackNSlash/harness
```

**프로파일 상속** — `profiles/<이름>/profile.json` 에 `{ "extends": "부모" }` 를 두면

- `AGENTS.md` 관리 블록에 조상 → 자손 순서로 조각이 이어 붙습니다.
- `eslint.config.js` 같은 파일은 자식에 있으면 자식 것, 없으면 부모 것을 씁니다.
- `profile.json` 이 없는 프로파일은 예전과 똑같이 동작합니다.

**game 프로파일** — `react` + `vite` + `three` 가 함께 있으면 game 으로 감지됩니다.
react-vite 규칙에 더해 "`rules/` 에서는 React·three·DOM 금지" 를 ESLint 오류로 막습니다.

**선언이 감지보다 우선** — `kmjharness.json` 에 `profile` 이 적혀 있으면 감지 결과가 달라도 그것을 따릅니다.
감지 규칙이 늘어나도 이미 편입된 레포가 저절로 다른 프로파일로 바뀌지 않게 하기 위함입니다.
다를 때는 `doctor` 가 info 로 알려 줍니다.

**바깥 층(layers)** — 하네스 밖에 원본을 둔 규칙을 붙입니다. 단일 출처는 복사하지 않습니다.

```jsonc
// 게임 레포의 kmjharness.json
"layers": ["kmjHackNSlash/harness"]     // 워크스페이스(github2) 기준 경로
```

층 폴더에는 `AGENTS.fragment.md`(필수), `layer.json`(이름·버전), `toolchain.json`(이 층이 더하는 버전)을 둡니다.
층은 하네스 표준에 없는 버전만 더할 수 있고, 위층 표준을 덮지 못합니다. 워크스페이스 밖을 가리키는 경로는 거부합니다.

**모노레포** — `pnpm-workspace.yaml`(또는 `package.json` 의 `workspaces`)이 있으면
하위 패키지 의존성까지 합쳐서 프로파일 감지와 버전 비교를 합니다. 스크립트 계약은 맨 위 `package.json` 기준입니다.

---

## 안전장치

- **`plan`은 절대 쓰지 않습니다.** 쓰는 곳은 `apply` 하나뿐입니다.
- **미리보기 없이 적용되지 않습니다.** 파일 이름을 누르면 적용될 내용(삭제될 파일은 현재 내용)을 볼 수 있습니다.
- **구현되지 않은 레벨은 계획 자체를 거부합니다.** 파일은 그대로인데 레벨 숫자만 올라가는 일이 없습니다.
- **머지 충돌 중인 레포는 적용 버튼이 비활성화됩니다.**
- **`AGENTS.md`의 마커 바깥, 기존 스크립트, 기존 `ci.yml`은 덮어쓰지 않습니다.**
- **관리 파일을 손으로 고치면 `doctor`가 drift로 잡아냅니다.** 조용히 덮어써서 작업을 날리지 않습니다.
- 서버는 `127.0.0.1`에만 바인딩합니다.

---

## 문서

- [`docs/ci-migration.md`](docs/ci-migration.md) — 배포가 섞인 CI를 2-job으로 나누는 방법
- [`docs/decisions/`](docs/decisions) — 왜 이렇게 정했는지 (ADR)
- [`docs/learning/`](docs/learning) — AI 활용 학습 트랙

---

## 라이선스

MIT
