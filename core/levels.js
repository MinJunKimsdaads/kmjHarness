// 편입 레벨. 새 레포는 항상 L0으로 들어와 한 칸씩 올라간다.
//
// implemented: false 인 레벨은 plan/apply가 거부한다 — 파일은 그대로인데
// 레벨 숫자만 올라가 대시보드가 거짓말하는 사고를 막기 위한 것.
//
// 각 레벨의 detail/writes/risk/after/revert 는 대시보드가 그대로 보여준다.
// 여기가 레벨 설명의 단일 출처다.
export const LEVELS = [
  {
    id: 0,
    name: 'L0 관찰',
    summary: '등록만. 파일을 건드리지 않고 진단만 한다.',
    detail: '레포와 하네스가 서로를 가리키게만 만듭니다. 코드도 설정도 손대지 않으므로 아무것도 깨질 수 없습니다. '
          + '먼저 이 상태로 두고 진단 결과만 보면서, 이 레포를 어디까지 표준에 맞출지 판단하면 됩니다.',
    writes: ['kmjharness.json (핸드셰이크 선언)'],
    keeps: ['모든 기존 파일'],
    risk: 'none',
    after: null,
    revert: 'kmjharness.json 파일 하나만 지우면 원래대로입니다.',
    implemented: true,
  },
  {
    id: 1,
    name: 'L1 기본',
    summary: '에이전트 컨텍스트와 공통 파일을 배포. 검증 워크플로는 경고 모드.',
    detail: 'AI 에이전트가 이 레포의 규칙을 알게 만드는 단계입니다. 기존 CLAUDE.md가 있으면 그 내용을 '
          + 'AGENTS.md의 사용자 영역으로 옮기고, 공통 규약은 마커 안쪽에 넣습니다. '
          + 'GitHub 검증 워크플로도 이때 들어가지만 경고 모드라 실패해도 머지를 막지 않습니다.',
    writes: [
      'AGENTS.md — 마커 안쪽은 kmjh, 바깥은 당신',
      'CLAUDE.md — "@AGENTS.md" 한 줄',
      '.editorconfig',
      '.claude/settings.json — ../kmjHarness 참조 선언',
      '.github/workflows/kmjh-verify.yml — 경고 모드',
    ],
    keeps: ['기존 ci.yml', 'package.json', '린트·포맷 설정'],
    risk: 'low',
    after: null,
    revert: '추가된 파일들을 지우면 됩니다. 기존 파일은 CLAUDE.md 외에 바뀐 게 없습니다.',
    implemented: true,
  },
  {
    id: 2,
    name: 'L2 계약',
    summary: '스크립트 계약(verify) · 포맷터 통일 · 줄바꿈 정규화. 린트 규칙은 그대로 둔다.',
    detail: '이 하네스의 핵심인 verify 스크립트가 생기는 단계입니다. 없는 스크립트만 채우고 '
          + '기존 스크립트는 절대 덮어쓰지 않습니다. 검증 워크플로가 차단 모드로 바뀌어 '
          + 'CI 실패 시 머지가 막힙니다. 린트 규칙 자체는 아직 손대지 않으므로 위험이 낮습니다.',
    writes: [
      'package.json scripts — 없는 것만 추가 (verify · test:coverage 등)',
      '.prettierrc — 공통 포맷 규칙',
      '.gitattributes — 줄바꿈 정규화',
      '.github/workflows/kmjh-verify.yml — 차단 모드로 교체',
      '.kmjharness/manifest.json — 관리 파일 해시',
    ],
    keeps: ['기존 스크립트', '기존 린트 규칙', '기존 ci.yml'],
    risk: 'low',
    after: 'verify 를 한 번 돌려 실제로 통과하는지 확인하세요.',
    revert: 'package.json에서 추가된 스크립트를 지우고 .prettierrc · .gitattributes를 삭제하면 됩니다.',
    implemented: true,
  },
  {
    id: 3,
    name: 'L3 린트',
    summary: 'ESLint 9 flat config 통일. 린트 툴체인 상향 + 구식 .eslintrc 제거.',
    detail: '린트 규칙이 실제로 바뀌는 첫 단계라 새 경고나 오류가 나올 수 있습니다. '
          + '공용 flat config는 기존 문제를 error가 아닌 warn으로 두어 편입 시 레포가 깨지지 않게 합니다. '
          + '정리가 끝난 뒤 루트 eslint.config.js에서 원하는 규칙만 error로 올리면 됩니다.',
    writes: [
      '.kmjharness/eslint.config.js — 공용 flat config',
      'eslint.config.js — 공용 설정을 import 하는 얇은 파일',
      '.eslintrc.* 삭제 — ESLint 9가 대체',
      'package.json — 린트 의존성 교체 (eslint 9 · typescript-eslint 8)',
    ],
    keeps: ['소스 코드', 'ci.yml', '빌드·테스트 설정'],
    risk: 'medium',
    after: '반드시 의존성을 다시 설치한 뒤 verify 를 돌리세요. 설치 전에는 lint가 실패합니다.',
    revert: 'git으로 되돌리는 것이 가장 안전합니다. 적용 전에 커밋해두세요.',
    implemented: true,
  },
  {
    id: 4,
    name: 'L4 완전',
    summary: '툴체인 버전까지 완전 일치 (React 19 · Node 22 · pnpm).',
    detail: '프레임워크 메이저 버전을 올리는 단계라 실제 동작이 바뀔 수 있습니다. '
          + '다른 레벨과 달리 코드 수정이 함께 필요할 가능성이 높으므로, '
          + '반드시 별도 브랜치에서 진행하고 앱을 직접 실행해 확인해야 합니다.',
    writes: [
      'package.json dependencies · devDependencies',
      '.nvmrc · engines.node',
      'packageManager 필드',
    ],
    keeps: ['소스 코드 (다만 마이그레이션이 필요할 수 있음)'],
    risk: 'high',
    after: '설치 → verify → 앱을 실제로 띄워서 눈으로 확인.',
    revert: '반드시 브랜치를 따로 파고 진행하세요.',
    implemented: false,
  },
];

export const RISK_LABEL = { none: '위험 없음', low: '낮음', medium: '중간', high: '높음' };
export const levelById = (id) => LEVELS.find((l) => l.id === id) ?? LEVELS[0];
