import { vi } from 'vitest';

// Global environment setup using vi.hoisted()
vi.hoisted(() => {
  // Set all required environment variables globally
  process.env.ENVIRONMENT = 'development';

  process.env.LOG_OUTPUT = 'console';
  process.env.LOG_LEVEL = 'debug';

  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

  // Blockchain configuration
  process.env.CHAIN = 'ethereum';

  // Consensus layer
  process.env.CONSENSUS_LOOKBACK_SLOT = '1000';
  process.env.CONSENSUS_ARCHIVE_API_URL = 'https://beacon.example.com';
  process.env.CONSENSUS_FULL_API_URL = 'https://beacon-bkp.example.com';
  process.env.CONSENSUS_API_REQUEST_PER_SECOND = '10';

  // Execution layer
  process.env.EXECUTION_API_URL = 'https://execution.example.com';
  process.env.EXECUTION_API_BKP_URL = 'https://execution-bkp.example.com';
  process.env.EXECUTION_API_REQUEST_PER_SECOND = '10';
});

// Ignore specific global errors so Vitest won't fail the run
const ignore = (err: unknown) => {
  const msg = String(err ?? '');
  // Sourcemap missing (Prisma runtime)
  if (msg.includes('library.js.map')) return true;
  // XState v5 getInitialSnapshot bug - known issue: https://github.com/statelyai/xstate/issues/5077
  if (msg.includes('this.logic.getInitialSnapshot is not a function')) return true;
  return false;
};

process.on('unhandledRejection', (err) => {
  if (!ignore(err)) throw err;
});

process.on('uncaughtException', (err) => {
  if (!ignore(err)) throw err;
});
