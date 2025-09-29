import { resolve } from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // No setupFiles for e2e tests - they should use real environment variables
    testTimeout: 300000, // 5 minutes timeout for E2E tests
    hookTimeout: 300000,
    teardownTimeout: 300000,
    retry: 1,
    bail: 5,
    disableConsoleIntercept: true,
    include: ['src/e2e/**/*.test.ts', 'src/e2e/**/*.test.js'], // Only include e2e test files
    exclude: ['src/e2e/**/*.json', 'src/e2e/**/mocks/**'], // Exclude JSON files and mocks
  },
  resolve: {
    alias: {
      '@': resolve(__dirname),
    },
  },
});
