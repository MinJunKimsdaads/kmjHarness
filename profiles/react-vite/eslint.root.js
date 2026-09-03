// 이 파일은 당신의 영역입니다. kmjh가 덮어쓰지 않습니다.
// 공통 규칙은 .kmjharness/eslint.config.js 에 있고, 여기서 프로젝트 예외만 덧붙이세요.
import harness from './.kmjharness/eslint.config.js';

export default [
  ...harness,

  // 예) 이 프로젝트에서만 더 엄격하게:
  // { files: ['**/*.{ts,tsx}'], rules: { 'react-hooks/exhaustive-deps': 'error' } },
];
