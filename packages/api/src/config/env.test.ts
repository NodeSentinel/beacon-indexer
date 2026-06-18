import { beforeEach, describe, expect, it, vi } from 'vitest';

const validEnv = {
  ALLOWED_ORIGINS: 'http://localhost:3000',
  API_TOKEN_SECRET: 'a'.repeat(32),
  CHAIN: 'ethereum',
  COINGECKO_TOKEN_NAME: 'ethereum',
  COINGECKO_TOKEN_PRICE_API_URL: 'https://price.example.com',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
  EXECUTION_RPC_URL: 'https://execution.example.com',
  TELEGRAM_BOT_TOKEN: 'token',
};

describe('parseApiEnv', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...process.env, ...validEnv };
  });

  it('parses the execution RPC URL used by API contract reads', async () => {
    const { parseApiEnv } = await import('./env.js');
    const env = parseApiEnv(validEnv);

    expect(env.EXECUTION_RPC_URL).toBe('https://execution.example.com');
  });

  it('rejects an invalid execution RPC URL', async () => {
    const { parseApiEnv } = await import('./env.js');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(() =>
        parseApiEnv({
          ...validEnv,
          EXECUTION_RPC_URL: 'not-a-url',
        }),
      ).toThrow();
    } finally {
      consoleError.mockRestore();
    }
  });
});
