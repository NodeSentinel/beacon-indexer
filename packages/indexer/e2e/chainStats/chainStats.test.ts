import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ChainStatsController } from '@/src/services/consensus/controllers/chainStats.js';
import { ChainStatsStorage } from '@/src/services/consensus/storage/chainStats.js';

describe('Chain Stats', () => {
  let prisma: PrismaClient;
  let chainStatsStorage: ChainStatsStorage;
  let chainStatsController: ChainStatsController;
  let beaconTime: BeaconTime;

  // Gnosis: 16 slots per epoch
  // Test epoch 100: slots 1600-1615 (inclusive)
  const TEST_EPOCH = 100;
  const LOOKBACK_SLOT = 0;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
  });

  beforeEach(async () => {
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: LOOKBACK_SLOT,
    });

    chainStatsStorage = new ChainStatsStorage(prisma);
    chainStatsController = new ChainStatsController(chainStatsStorage, beaconTime);

    // Clean test tables
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "chain_epoch_stats", "validator", "validator_deposits", "validator_request_consolidations" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should compute and insert chain stats for an epoch', async () => {
    // Insert validators with various statuses
    // Active: 3 ongoing (status=2) + 1 exiting (status=3) + 1 slashed (status=4) = 5 total
    // Entering: 1 pending_queued (status=1) = 1 (pending_initialized is not counted)
    // Exiting: 1 active_exiting (status=3) = 1
    // Other: 1 exited_unslashed (status=5) - should not be counted
    await prisma.validator.createMany({
      data: [
        { id: 1, status: 2, balance: BigInt(32000000000), effectiveBalance: BigInt(32000000000) },
        { id: 2, status: 2, balance: BigInt(33000000000), effectiveBalance: BigInt(32000000000) },
        { id: 3, status: 2, balance: BigInt(34000000000), effectiveBalance: BigInt(32000000000) },
        { id: 4, status: 3, balance: BigInt(32000000000), effectiveBalance: BigInt(32000000000) },
        { id: 5, status: 4, balance: BigInt(16000000000), effectiveBalance: BigInt(16000000000) },
        { id: 6, status: 0, balance: BigInt(32000000000), effectiveBalance: BigInt(32000000000) },
        { id: 7, status: 1, balance: BigInt(32000000000), effectiveBalance: BigInt(32000000000) },
        { id: 8, status: 5, balance: BigInt(32000000000), effectiveBalance: BigInt(32000000000) },
      ],
    });

    // Insert consolidation requests
    // Epoch 100 slot range: 1600-1615
    // 2 distinct source_pubkey within range, 1 outside range
    const pad = (n: number) => '0x' + n.toString().padStart(96, '0');
    await prisma.validatorConsolidationsRequests.createMany({
      data: [
        { slot: 1600, sourcePubkey: pad(1), targetPubkey: pad(10) },
        { slot: 1610, sourcePubkey: pad(2), targetPubkey: pad(20) },
        // Same source as first, different slot - should NOT add to distinct count
        { slot: 1605, sourcePubkey: pad(1), targetPubkey: pad(30) },
        // Outside slot range - should NOT be counted
        { slot: 1616, sourcePubkey: pad(3), targetPubkey: pad(40) },
      ],
    });

    const result = await chainStatsController.computeStats(TEST_EPOCH);
    expect(result.epoch).toBe(TEST_EPOCH);
    expect(result.skipped).toBe(false);

    const row = await prisma.chainEpochStats.findUnique({ where: { epoch: TEST_EPOCH } });
    expect(row).not.toBeNull();
    expect(row!.totalActiveValidators).toBe(5);
    // 3 * 32B + 1 * 32B + 1 * 16B = 144B
    expect(row!.totalStaked).toBe(BigInt(144000000000));
    expect(row!.validatorsEntering).toBe(1);
    expect(row!.validatorsExiting).toBe(1);
    expect(row!.validatorsConsolidating).toBe(2);
  });

  it('should skip if epoch already exists (via lastProcessed check)', async () => {
    // Insert a pre-existing row for epoch 100
    await prisma.chainEpochStats.create({
      data: {
        epoch: TEST_EPOCH,
        totalActiveValidators: 999,
        totalStaked: BigInt(999),
        validatorsEntering: 999,
        validatorsExiting: 999,
        validatorsConsolidating: 999,
      },
    });

    const result = await chainStatsController.computeStats(TEST_EPOCH);
    expect(result.skipped).toBe(true);

    // Values should remain unchanged (stale data)
    const row = await prisma.chainEpochStats.findUnique({ where: { epoch: TEST_EPOCH } });
    expect(row!.totalActiveValidators).toBe(999);
  });

  it('should handle zero validators and zero consolidations', async () => {
    const result = await chainStatsController.computeStats(TEST_EPOCH);
    expect(result.skipped).toBe(false);

    const row = await prisma.chainEpochStats.findUnique({ where: { epoch: TEST_EPOCH } });
    expect(row).not.toBeNull();
    expect(row!.totalActiveValidators).toBe(0);
    expect(row!.totalStaked).toBe(BigInt(0));
    expect(row!.validatorsEntering).toBe(0);
    expect(row!.validatorsExiting).toBe(0);
    expect(row!.validatorsConsolidating).toBe(0);
  });
});
