import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Module import isolation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('dotenv', () => ({
      config: vi.fn(() => ({})),
    }));

    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.doUnmock('dotenv');

    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }

    Object.assign(process.env, originalEnv);
  });

  it('imports daily archive storage without requiring the full indexer env', async () => {
    await expect(
      import('@/src/services/consensus/storage/dailyArchive.js'),
    ).resolves.toHaveProperty('DailyArchiveStorage');
  });

  it('imports incident storage without requiring the full indexer env', async () => {
    await expect(import('@/src/services/consensus/storage/incident.js')).resolves.toHaveProperty(
      'IncidentStorage',
    );
  });
});
