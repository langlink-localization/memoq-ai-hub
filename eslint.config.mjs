import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const correctnessRules = {
  'no-constant-binary-expression': 'error',
  'no-unreachable-loop': 'error',
  'no-unsafe-finally': 'error'
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.vite/**',
      '**/out/**',
      '**/bin/**',
      '**/obj/**',
      '**/build-resources/**',
      '**/helper/**',
      '.worktrees/**',
      '.pnpm-store/**',
      '.zcode/**'
    ]
  },
  {
    files: [
      'apps/desktop/src/**/*.{js,mjs,jsx}',
      'apps/desktop/test/**/*.{js,mjs}',
      'tooling/scripts/**/*.{js,mjs}',
      'tests/repo/**/*.mjs'
    ],
    ...eslint.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.es2025
    },
    rules: correctnessRules
  },
  {
    files: [
      'apps/desktop/src/**/*.{js,mjs}',
      'apps/desktop/test/**/*.{js,mjs}',
      'tooling/scripts/**/*.{js,mjs}',
      'tests/repo/**/*.mjs'
    ],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ['apps/desktop/src/renderer/src/**/*.{js,mjs,jsx}'],
    languageOptions: {
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module' }
  }
];
