// kmjHarness가 생성했습니다. 직접 수정하지 마세요 — 변경은 kmjh sync로.
//
// game 프로파일 공통 ESLint 규칙 (ESLint 9 flat config).
// 앞부분은 react-vite 프로파일과 같고(test/profiles.test.js 가 같음을 확인), 끝에 게임 규칙을 더한다.
// 프로젝트별 예외는 레포 루트의 eslint.config.js 에서 덧붙이세요.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// 게임 규칙 코드가 가져다 쓰면 안 되는 것 — 화면(React)·그리기(three)에 묶이면 테스트와 재사용이 깨진다.
const RULES_FORBIDDEN = ['react', 'react-dom', 'react-dom/*', 'react-router', 'react-router-dom', 'zustand', 'three', 'three/*', '@react-three/*'];

export default tseslint.config(
  { ignores: ['dist', 'build', 'release', 'coverage', 'node_modules', '.kmjharness'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // 언더스코어로 시작하는 것은 의도적 미사용으로 본다
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      'no-empty': 'warn',
    },
  },
  // ── game 규칙 ──────────────────────────────────────────────
  // rules/ 는 순수한 게임 규칙. React·three·DOM 없이 Node에서도 돌아야 한다.
  // 이건 구조 규칙이라 처음부터 error 다 (편입 때 기존 코드가 없는 새 폴더이므로).
  {
    files: ['rules/**/*.{ts,tsx}', '**/rules/src/**/*.{ts,tsx}', 'src/rules/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: RULES_FORBIDDEN, message: 'rules/ 는 React·three·DOM 없이 돌아야 합니다. 화면 쪽(app/)에서 연결하세요.' }],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'rules/ 에서는 DOM을 쓰지 않습니다.' },
        { name: 'document', message: 'rules/ 에서는 DOM을 쓰지 않습니다.' },
        { name: 'requestAnimationFrame', message: '규칙은 고정 틱으로 돕니다. 프레임 루프는 화면 쪽에서.' },
      ],
      'no-restricted-properties': ['warn',
        { object: 'Math', property: 'random', message: '규칙에서는 시드 난수를 쓰세요 (재현 가능해야 합니다).' },
      ],
    },
  },
  // Prettier와 겹치는 포맷 규칙을 끈다. 반드시 마지막이어야 한다.
  prettier,
);
