import { resolve } from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 10000, // 10 seconds max per test
    hookTimeout: 10000, // 10 seconds max per hook
    teardownTimeout: 10000, // 10 seconds max for teardown
    retry: 1, // Only retry failed tests once
    bail: 5, // Stop after 5 test failures
    //silent: false, // Show console logs
    disableConsoleIntercept: true,
    include: ['src/**/*.test.ts'], // Only include unit test files
    exclude: ['e2e/**/*', 'node_modules'], // Exclude e2e tests from this config
  },
  resolve: {
    alias: {
      '@': resolve(__dirname),
    },
  },
});
