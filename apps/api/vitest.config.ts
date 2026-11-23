import { defineConfig } from 'vitest/config';

// Unit + HTTP tests that need no database. MySQL integration tests run with
// vitest.integration.config.ts (`npm run test:integration`).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts', 'node_modules/**', 'dist/**'],
  },
});
