// kmjHarness가 생성했습니다. 직접 수정하지 마세요 — 변경은 kmjh sync로.
//
// react-vite 프로파일 공통 ESLint 규칙 (ESLint 9 flat config).
// 프로젝트별 예외는 레포 루트의 eslint.config.js 에서 덧붙이세요.
//
// 규칙 강도 방침: 편입 시 레포가 깨지지 않도록 기존 문제는 'warn'으로 둡니다.
// 정리가 끝난 레포는 루트 설정에서 'error'로 올리면 됩니다.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

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
  // Prettier와 겹치는 포맷 규칙을 끈다. 반드시 마지막이어야 한다.
  prettier,
);
