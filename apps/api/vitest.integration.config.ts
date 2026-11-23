import { defineConfig } from 'vitest/config';

// Integration tests against a real MySQL/MariaDB test database.
// Files share one database, so they run one at a time.
export default defineConfig({
  test: {
    include: ['src/__integration__/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
