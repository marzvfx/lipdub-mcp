import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The no-secrets guard inspects the compiled output in dist/, so tests must not
    // run in parallel with a build that is rewriting it.
    fileParallelism: false,
  },
});
