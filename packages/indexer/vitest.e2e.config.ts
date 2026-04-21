import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Forces e2e tests to use the hardcoded local Docker test database.
    testTimeout: 300000, // 5 minutes timeout for E2E tests
    hookTimeout: 300000,
    teardownTimeout: 300000,
    retry: 1,
    bail: 5,
    disableConsoleIntercept: true,
    setupFiles: [resolve(__dirname, 'e2e/setup.ts')],
    include: ['e2e/**/*.test.ts'], // Include all e2e test files
    exclude: ['e2e/**/mocks/**'], // Exclude mocks
    // Run e2e tests in a single worker to avoid cross-file DB interference
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname),
    },
  },
});
