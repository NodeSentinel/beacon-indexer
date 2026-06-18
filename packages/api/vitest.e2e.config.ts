import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      LOG_LEVEL: 'silent',
    },
    testTimeout: 60000, // 1 minute timeout for E2E tests
    hookTimeout: 60000,
    teardownTimeout: 60000,
    retry: 1,
    bail: 5,
    disableConsoleIntercept: true,
    include: ['e2e/**/*.test.ts'],
    exclude: ['e2e/**/mocks/**'],
    setupFiles: [resolve(__dirname, 'e2e/setup.ts')],
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
      '@': resolve(__dirname, 'src'),
    },
  },
});
