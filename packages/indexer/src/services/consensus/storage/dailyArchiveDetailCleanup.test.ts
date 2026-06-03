import { describe, expect, it, vi } from 'vitest';

import { DailyArchiveDetailCleanupStorage } from './dailyArchiveDetailCleanup.js';

describe('DailyArchiveDetailCleanupStorage', () => {
  /**
   * Scenario: VACUUM FULL receives the expected published daily archive partition.
   * The storage layer must quote the partition name as a PostgreSQL identifier before
   * executing raw SQL because table names cannot be passed as bind parameters.
   */
  it('vacuums a validator daily archive partition with the expected table format', async () => {
    // This Prisma stub captures the raw VACUUM statement without touching a real database.
    const prisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    };

    // This storage instance exercises only the partition-name validation and SQL construction path.
    const storage = new DailyArchiveDetailCleanupStorage(prisma as never, 14);

    // Run VACUUM FULL against a valid daily archive partition name.
    await storage.vacuumDailyArchivePartition('validator_daily_archive_20251201');

    // The raw SQL targets the quoted partition identifier exactly.
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'VACUUM FULL "validator_daily_archive_20251201"',
    );
  });

  /**
   * Scenario: VACUUM FULL receives a table name that is not one of our daily archive partitions.
   * The storage layer must reject it before constructing raw SQL so cleanup cannot compact an
   * unexpected table if catalog data or caller input is wrong.
   */
  it('rejects partition names outside the validator_daily_archive_yyyymmdd format', async () => {
    // This Prisma stub proves invalid input is rejected before raw SQL execution.
    const prisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    };

    // This storage instance exercises only the partition-name validation path.
    const storage = new DailyArchiveDetailCleanupStorage(prisma as never, 14);

    // Try a syntactically safe but wrong archive table prefix.
    await expect(
      storage.vacuumDailyArchivePartition('validator_hourly_archive_2025120100'),
    ).rejects.toThrow('Unsafe daily archive partition name: validator_hourly_archive_2025120100');

    // Try a daily archive-like table with the wrong date width.
    await expect(
      storage.vacuumDailyArchivePartition('validator_daily_archive_202512'),
    ).rejects.toThrow('Unsafe daily archive partition name: validator_daily_archive_202512');

    // No raw SQL should run for rejected names.
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
