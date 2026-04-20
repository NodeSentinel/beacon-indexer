import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidatorActivityStatusStorage } from './validatorActivityStatus.js';

describe('ValidatorActivityStatusStorage transaction scope', () => {
  let prisma: {
    $executeRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
    incidentProcessorState: {
      upsert: ReturnType<typeof vi.fn>;
    };
  };
  let tx: {
    incidentProcessorState: {
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $executeRaw: ReturnType<typeof vi.fn>;
  };
  let storage: ValidatorActivityStatusStorage;

  beforeEach(() => {
    // Recreate the mocked Prisma client and transaction client for each test so
    // every assertion observes only the calls made by that scenario.
    tx = {
      incidentProcessorState: {
        upsert: vi.fn().mockResolvedValue({
          processor: 'validator-activity-status',
          lastProcessedSlot: 4,
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
    };

    prisma = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $transaction: vi.fn(async (callback: (transactionClient: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      incidentProcessorState: {
        upsert: vi.fn().mockResolvedValue({
          processor: 'validator-activity-status',
          lastProcessedSlot: 4,
        }),
      },
    };

    // Build the storage with a small timing config because the test only cares
    // about transaction boundaries, not about real slot timestamps.
    storage = new ValidatorActivityStatusStorage(
      // The storage uses only the mocked methods exercised below.
      prisma as never,
      {
        genesisTimeSec: 0,
        secPerSlot: 12,
      },
      16,
    );
  });

  it('opens one transaction per processed slot and advances the cursor incrementally', async () => {
    // Stub the slot-local SQL helpers so the test can focus only on transaction
    // boundaries and processor-state writes.
    const updateSlotSnapshotsSpy = vi
      .spyOn(storage as never, 'updateSlotSnapshots')
      .mockResolvedValue(undefined);
    const reconcileOpenIncidentsSpy = vi
      .spyOn(storage as never, 'reconcileOpenIncidents')
      .mockResolvedValue(undefined);

    // Process two pending slots so the test can observe whether storage keeps
    // one large transaction or commits each slot independently.
    await storage.syncCurrentActivityStatus({
      newestProcessableSlot: 6,
      inactiveMissedCount: 1,
      maxAttestationDelay: 1,
    });

    // The processor state bootstrap is not part of the per-slot work. After
    // that, each slot must execute inside its own short transaction.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.incidentProcessorState.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);

    // The slot-local work must still run for both pending slots and use the
    // transaction client created for that slot.
    expect(updateSlotSnapshotsSpy).toHaveBeenNthCalledWith(1, tx, 5, 1, 1);
    expect(updateSlotSnapshotsSpy).toHaveBeenNthCalledWith(2, tx, 6, 1, 1);
    expect(reconcileOpenIncidentsSpy).toHaveBeenNthCalledWith(1, tx, {
      processedSlot: 5,
    });
    expect(reconcileOpenIncidentsSpy).toHaveBeenNthCalledWith(2, tx, {
      processedSlot: 6,
    });

    // The durable bookmark must advance inside each slot transaction so a
    // crash can only replay at most one slot on the next run.
    expect(tx.incidentProcessorState.update).toHaveBeenNthCalledWith(1, {
      where: { processor: 'validator-activity-status' },
      data: { lastProcessedSlot: 5 },
    });
    expect(tx.incidentProcessorState.update).toHaveBeenNthCalledWith(2, {
      where: { processor: 'validator-activity-status' },
      data: { lastProcessedSlot: 6 },
    });
  });
});
