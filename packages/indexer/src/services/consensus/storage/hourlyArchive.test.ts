import { describe, expect, it, vi } from 'vitest';

import { HourlyArchiveStorage } from './hourlyArchive.js';

// This suite verifies resource-friendly hourly archive database writes.
describe('HourlyArchiveStorage', () => {
  // This test verifies hourly aggregation is split by validator ranges.
  it('archives an hour in validator batches', async () => {
    // This list records every raw SQL call made inside the archive transaction.
    const rawCalls: string[] = [];

    // This transaction client captures SQL and simulates a validator table larger than one batch.
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
      $executeRaw: vi.fn((strings: TemplateStringsArray) => {
        rawCalls.push(strings.join('?'));
        return Promise.resolve(undefined);
      }),
      $queryRaw: vi.fn().mockResolvedValue([{ max_idx: 100001 }]),
      archive: {
        update: vi.fn().mockResolvedValue(undefined),
      },
    };

    // This prisma stub runs the interactive transaction callback with the mocked transaction.
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => {
        await callback(tx);
      }),
    };

    // This storage instance executes the real archive method against the prisma stub.
    const storage = new HourlyArchiveStorage(prisma as never);

    // This call archives one hour and should split aggregation across validator ranges.
    await storage.archiveHourAtomically(
      new Date('2025-12-16T13:00:00.000Z'),
      100,
      200,
      10,
      20,
      5,
      'validator_hourly_archive_2025121613',
      'committee_100_200',
      'epoch_rewards_10_20',
    );

    // This filter keeps only the heavyweight archive INSERT statements.
    const insertCalls = rawCalls.filter((sql) =>
      sql.includes('INSERT INTO validator_hourly_archive'),
    );

    // This assertion verifies one INSERT is executed per validator batch.
    expect(insertCalls).toHaveLength(3);

    // This assertion verifies the batch loop is driven by validator cardinality.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
