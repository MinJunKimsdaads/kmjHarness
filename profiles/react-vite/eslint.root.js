// 이 파일은 당신의 영역입니다. kmjh가 덮어쓰지 않습니다.
// 공통 규칙은 .kmjharness/eslint.config.js 에 있고, 여기서 프로젝트 예외만 덧붙이세요.
import harness from './.kmjharness/eslint.config.js';

export default [
  ...harness,

  // 설정 파일이 두 곳(루트·.kmjharness)이라 typescript-eslint 최신판이 기준 폴더를 못 정하는 것을 막음
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },

  // 예) 이 프로젝트에서만 더 엄격하게:
  // { files: ['**/*.{ts,tsx}'], rules: { 'react-hooks/exhaustive-deps': 'error' } },
];
