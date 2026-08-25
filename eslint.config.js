import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain .mjs helper scripts get their Node globals from the runtime rather than
    // from @types/node, so they have to be declared here or every `process` reference
    // is reported as undefined.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Upstream JSON is genuinely unknown at the boundary; we narrow it explicitly
      // in src/lipdub/client.ts rather than pretending it is typed.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },
);
