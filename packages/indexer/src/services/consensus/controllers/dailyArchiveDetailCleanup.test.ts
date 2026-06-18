import { describe, expect, it, vi } from 'vitest';

import { DailyArchiveDetailCleanupController } from './dailyArchiveDetailCleanup.js';

import {
  DailyArchiveDetailCleanupStorage,
  DailyArchiveDetailCleanupTarget,
} from '@/src/services/consensus/storage/dailyArchiveDetailCleanup.js';

describe('DailyArchiveDetailCleanupController', () => {
  /**
   * Scenario: one old daily partition still has JSON detail across several batches.
   * The controller must keep cleaning the selected day until the partition is done,
   * then vacuum that exact partition once so PostgreSQL releases the dead tuple space.
   */
  it('cleans one daily partition to completion and vacuums it', async () => {
    // This target represents the oldest daily archive partition outside the detail retention window.
    const target: DailyArchiveDetailCleanupTarget = {
      targetDay: new Date('2025-12-01T00:00:00.000Z'),
      partitionName: 'validator_daily_archive_20251201',
    };

    // The first two batches are full and the third is partial, proving the controller continues
    // within the same wake until the selected day has no more detail rows to clear.
    const cleanDailyArchiveDetailBatch = vi
      .fn()
      .mockResolvedValueOnce(5_000)
      .mockResolvedValueOnce(5_000)
      .mockResolvedValueOnce(250);

    // This storage fake exposes only the cleanup methods used by the controller.
    const storage = {
      findDailyArchiveDetailCleanupTarget: vi.fn().mockResolvedValue(target),
      cleanDailyArchiveDetailBatch,
      vacuumDailyArchivePartition: vi.fn().mockResolvedValue(undefined),
    } as unknown as DailyArchiveDetailCleanupStorage;

    // Run one cleanup wake with the production default batch size.
    const controller = new DailyArchiveDetailCleanupController(storage);
    const result = await controller.cleanupOldDailyDetails();

    // The result reports only batches that updated rows and confirms one partition was vacuumed.
    expect(result).toEqual({ batches: 3, rows: 10_250, vacuumedPartitions: 1 });

    // Every batch targets the same day and uses the 5k default batch size.
    expect(cleanDailyArchiveDetailBatch).toHaveBeenCalledTimes(3);
    expect(cleanDailyArchiveDetailBatch).toHaveBeenNthCalledWith(1, target.targetDay, 5_000);
    expect(cleanDailyArchiveDetailBatch).toHaveBeenNthCalledWith(2, target.targetDay, 5_000);
    expect(cleanDailyArchiveDetailBatch).toHaveBeenNthCalledWith(3, target.targetDay, 5_000);

    // The partition is vacuumed after every JSON detail batch for the day has committed.
    expect(storage.vacuumDailyArchivePartition).toHaveBeenCalledWith(target.partitionName);
  });

  /**
   * Scenario: the selected partition has no remaining JSON detail by the time the batch runs.
   * The controller must not loop; it can vacuum the selected partition immediately.
   */
  it('vacuums the selected partition when the first batch updates zero rows', async () => {
    // This target was selected by the storage scan before the batch found no rows left to update.
    const target: DailyArchiveDetailCleanupTarget = {
      targetDay: new Date('2025-12-01T00:00:00.000Z'),
      partitionName: 'validator_daily_archive_20251201',
    };

    // Returning zero simulates a scan racing with rows that were already cleared.
    const storage = {
      findDailyArchiveDetailCleanupTarget: vi.fn().mockResolvedValue(target),
      cleanDailyArchiveDetailBatch: vi.fn().mockResolvedValue(0),
      vacuumDailyArchivePartition: vi.fn().mockResolvedValue(undefined),
    } as unknown as DailyArchiveDetailCleanupStorage;

    // Run the cleanup wake against a selected partition that no longer has detail rows.
    const controller = new DailyArchiveDetailCleanupController(storage);
    const result = await controller.cleanupOldDailyDetails();

    // Zero updated rows should not count as a batch, but the partition still needs compaction.
    expect(result).toEqual({ batches: 0, rows: 0, vacuumedPartitions: 1 });
    expect(storage.vacuumDailyArchivePartition).toHaveBeenCalledWith(target.partitionName);
  });

  /**
   * Scenario: there is no old daily partition outside the configured retention window.
   * The controller must do no database work beyond asking storage for a target.
   */
  it('does nothing when no daily partition is eligible', async () => {
    // A null target means retention has not expired for any daily archive partition.
    const storage = {
      findDailyArchiveDetailCleanupTarget: vi.fn().mockResolvedValue(null),
      cleanDailyArchiveDetailBatch: vi.fn(),
      vacuumDailyArchivePartition: vi.fn(),
    } as unknown as DailyArchiveDetailCleanupStorage;

    // Run one cleanup wake against an empty eligibility set.
    const controller = new DailyArchiveDetailCleanupController(storage);
    const result = await controller.cleanupOldDailyDetails();

    // No rows or partitions are changed when there is no eligible target.
    expect(result).toEqual({ batches: 0, rows: 0, vacuumedPartitions: 0 });
    expect(storage.cleanDailyArchiveDetailBatch).not.toHaveBeenCalled();
    expect(storage.vacuumDailyArchivePartition).not.toHaveBeenCalled();
  });
});
