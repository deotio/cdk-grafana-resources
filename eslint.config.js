const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: ['**/*.js', '**/*.d.ts', 'node_modules/', 'cdk.out/'],
  },
  {
    files: ['lib/**/*.ts', 'lambda/**/*.ts', 'test/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
