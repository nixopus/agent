import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 600_000,
    include: ['src/__tests__/e2e/**/*.e2e.test.ts'],
    globals: true,
    environment: 'node',
    pool: 'forks',
  },
});
