import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import {
  parseSlotPartitionName,
  parseEpochPartitionName,
  getHourlyArchivePartitionName,
} from '@/src/services/consensus/controllers/helpers/partitionNaming.js';
import { HourlyArchiveController } from '@/src/services/consensus/controllers/hourlyArchive.js';
import {
  PARTITION_TABLE_NAMES,
  PartitionController,
} from '@/src/services/consensus/controllers/partition.js';
import { HourlyArchiveStorage } from '@/src/services/consensus/storage/hourlyArchive.js';
import { PartitionStorage } from '@/src/services/consensus/storage/partition.js';

describe('Hourly Archive Process', () => {
  let prisma: PrismaClient;
  let partitionStorage: PartitionStorage;
  let hourlyArchiveStorage: HourlyArchiveStorage;
  let beaconTimeWithLookback: BeaconTime;
  let partitionController: PartitionController;
  let hourlyArchiveController: HourlyArchiveController;

  // Test data using real Gnosis chain data
  // Epoch 1586252: slots 25380032-25380047 (Dec-16-2025 13:58:20 - 13:59:35 UTC)
  // Using epoch 1586252 and 1586253 for testing
  const TEST_EPOCH_1 = 1586252;
  const LOOKBACK_SLOT = 25380000;
  const MAX_ATTESTATION_DELAY = 5;

  // Test validators
  const VALIDATOR_1 = 100;
  const VALIDATOR_2 = 200;

  // Test slots (within the partition range)
  // We'll use slots from the partition created for epoch 1586252
  let testSlots: number[];
  let testEpochs: number[];
  let hourStart: Date;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    // Initialize database connection
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    // Initialize services
    partitionStorage = new PartitionStorage(prisma);
    hourlyArchiveStorage = new HourlyArchiveStorage(prisma);

    // Create BeaconTime with lookbackSlot
    beaconTimeWithLookback = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: LOOKBACK_SLOT,
    });

    partitionController = new PartitionController(partitionStorage, beaconTimeWithLookback);

    hourlyArchiveController = new HourlyArchiveController(
      hourlyArchiveStorage,
      partitionController,
      beaconTimeWithLookback,
      MAX_ATTESTATION_DELAY,
    );

    // We'll calculate test slots and epochs after creating partitions in the test
    // For now, initialize with placeholder values
    testSlots = [];
    testEpochs = [];
    hourStart = new Date();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up partitions
    const committeePartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename 
      FROM pg_tables 
      WHERE tablename LIKE 'committee_%'
    `;
    for (const partition of committeePartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tablename}"`);
    }

    const epochRewardsPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename 
      FROM pg_tables 
      WHERE tablename LIKE 'epoch_rewards_%'
    `;
    for (const partition of epochRewardsPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tablename}"`);
    }

    const archivePartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename 
      FROM pg_tables 
      WHERE tablename LIKE 'validator_hourly_archive_%'
    `;
    for (const partition of archivePartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tablename}"`);
    }

    // Clean up test data - e2e tests always start with clean instances
    await prisma.$executeRawUnsafe(`DELETE FROM committee`);
    await prisma.$executeRawUnsafe(`DELETE FROM slot`);
    await prisma.$executeRawUnsafe(`DELETE FROM epoch_rewards`);
    await prisma.$executeRawUnsafe(`DELETE FROM epoch`);
    await prisma.$executeRawUnsafe(`DELETE FROM validator_hourly_archive`);

    // Reset archive master table
    await prisma.archive.upsert({
      where: { id: 1 },
      update: { lastHour: null },
      create: { id: 1, lastHour: null },
    });
  });

  it('should archive hourly data correctly with all source tables', async () => {
    // Step 1: Create partitions
    await partitionController.createPartitionForCommittee(TEST_EPOCH_1);
    await partitionController.createPartitionForEpochRewards(TEST_EPOCH_1);

    // Verify partitions exist and parse them to get slot/epoch ranges
    const committeePartitions = await partitionStorage.discoverPartitions(
      PARTITION_TABLE_NAMES.COMMITTEE,
    );
    const epochRewardsPartitions = await partitionStorage.discoverPartitions(
      PARTITION_TABLE_NAMES.EPOCH_REWARDS,
    );

    expect(committeePartitions.length).toBeGreaterThan(0);
    expect(epochRewardsPartitions.length).toBeGreaterThan(0);

    // Parse partition names to get slot and epoch ranges
    const committeePartition = parseSlotPartitionName(committeePartitions[0]);
    const epochRewardsPartition = parseEpochPartitionName(epochRewardsPartitions[0]);

    expect(committeePartition).not.toBeNull();
    expect(epochRewardsPartition).not.toBeNull();

    // Use fixed test slots and epochs from the partition start
    // 4 slots: start, start+1, start+2, start+3
    // Note: endSlot from partition is exclusive, but SQL BETWEEN is inclusive
    // So we use slots that are definitely < endSlot
    testSlots = [
      committeePartition!.start,
      committeePartition!.start + 1,
      committeePartition!.start + 2,
      committeePartition!.start + 3,
    ];

    testEpochs = [epochRewardsPartition!.start, epochRewardsPartition!.start + 1];

    // Calculate hour start timestamp from the partition datetime
    hourStart = committeePartition!.datetime!;

    // Get candidate to know the endSlot (needed for cleanup and marking as processed)
    const candidate = await partitionController.getHourToArchive();
    expect(candidate).not.toBeNull();
    expect(candidate?.hourStart).toStrictEqual(hourStart);

    // Insert mock data

    // Committee data (attestations)
    // Validator 100: slot 0 (delay=0), slot 1 (delay=3), slot 2 (delay=6 - missed), slot 3 (NULL - missed)
    // Validator 200: slot 0 (delay=2), slot 1 (delay=4), slot 2 (delay=1), slot 3 (delay=0)
    await prisma.committee.createMany({
      data: [
        {
          slot: testSlots[0],
          index: 0,
          aggregationBitsIndex: 0,
          validatorIndex: VALIDATOR_1,
          attestationDelay: 0,
        },
        {
          slot: testSlots[1],
          index: 0,
          aggregationBitsIndex: 0,
          validatorIndex: VALIDATOR_1,
          attestationDelay: 3,
        },
        {
          slot: testSlots[2],
          index: 0,
          aggregationBitsIndex: 0,
          validatorIndex: VALIDATOR_1,
          attestationDelay: 6,
        },
        {
          slot: testSlots[3],
          index: 0,
          aggregationBitsIndex: 0,
          validatorIndex: VALIDATOR_1,
          attestationDelay: null,
        },
        {
          slot: testSlots[0],
          index: 0,
          aggregationBitsIndex: 1,
          validatorIndex: VALIDATOR_2,
          attestationDelay: 2,
        },
        {
          slot: testSlots[1],
          index: 0,
          aggregationBitsIndex: 1,
          validatorIndex: VALIDATOR_2,
          attestationDelay: 4,
        },
        {
          slot: testSlots[2],
          index: 0,
          aggregationBitsIndex: 1,
          validatorIndex: VALIDATOR_2,
          attestationDelay: 1,
        },
        {
          slot: testSlots[3],
          index: 0,
          aggregationBitsIndex: 1,
          validatorIndex: VALIDATOR_2,
          attestationDelay: 0,
        },
      ],
    });

    // Block rewards + Execution rewards (all via slot table)
    // Validator 100: slot 0 - executionReward: 7000, slot 1 - consensusReward: 5000
    // Validator 200: slot 2 - executionReward: 8000, slot 3 - consensusReward: 6000
    await prisma.slot.createMany({
      skipDuplicates: true,
      data: [
        {
          slot: testSlots[0],
          proposerIndex: VALIDATOR_1,
          executionReward: '7000',
          processed: true,
        },
        {
          slot: testSlots[1],
          proposerIndex: VALIDATOR_1,
          consensusReward: BigInt(5000),
          processed: true,
        },
        {
          slot: testSlots[2],
          proposerIndex: VALIDATOR_2,
          executionReward: '8000',
          processed: true,
        },
        {
          slot: testSlots[3],
          proposerIndex: VALIDATOR_2,
          consensusReward: BigInt(6000),
          processed: true,
        },
        {
          slot: candidate!.endSlot,
          processed: true,
        },
      ],
    });

    // Epoch rewards
    // Validator 100: epoch 0 (head=100, target=200, source=300, inactivity=50, missed_*=0)
    //                epoch 1 (head=150, target=250, source=350, inactivity=75, missed_*=0)
    // Validator 200: epoch 0 (head=500, target=600, source=700, inactivity=100, missed_head=10, missed_target=20, missed_source=30, missed_inactivity=5)
    //                epoch 1 (head=550, target=650, source=750, inactivity=120, missed_head=15, missed_target=25, missed_source=35, missed_inactivity=8)
    await prisma.epochRewards.createMany({
      data: [
        {
          epoch: testEpochs[0],
          validatorIndex: VALIDATOR_1,
          head: BigInt(100),
          target: BigInt(200),
          source: BigInt(300),
          inactivity: BigInt(50),
          missedHead: BigInt(0),
          missedTarget: BigInt(0),
          missedSource: BigInt(0),
          missedInactivity: BigInt(0),
        },
        {
          epoch: testEpochs[1],
          validatorIndex: VALIDATOR_1,
          head: BigInt(150),
          target: BigInt(250),
          source: BigInt(350),
          inactivity: BigInt(75),
          missedHead: BigInt(0),
          missedTarget: BigInt(0),
          missedSource: BigInt(0),
          missedInactivity: BigInt(0),
        },
        {
          epoch: testEpochs[0],
          validatorIndex: VALIDATOR_2,
          head: BigInt(500),
          target: BigInt(600),
          source: BigInt(700),
          inactivity: BigInt(100),
          missedHead: BigInt(10),
          missedTarget: BigInt(20),
          missedSource: BigInt(30),
          missedInactivity: BigInt(5),
        },
        {
          epoch: testEpochs[1],
          validatorIndex: VALIDATOR_2,
          head: BigInt(550),
          target: BigInt(650),
          source: BigInt(750),
          inactivity: BigInt(120),
          missedHead: BigInt(15),
          missedTarget: BigInt(25),
          missedSource: BigInt(35),
          missedInactivity: BigInt(8),
        },
      ],
    });

    // Mark epochs as processed
    await prisma.epoch.createMany({
      skipDuplicates: true,
      data: [
        ...testEpochs.map((epoch) => ({
          epoch,
          processed: true,
        })),
        {
          epoch: candidate!.endEpoch,
          processed: true,
        },
      ],
    });

    // Step 3: Execute archive
    const archivedHour = await hourlyArchiveController.archive();

    expect(archivedHour).not.toBeNull();
    expect(archivedHour?.getTime()).toBe(hourStart.getTime());

    // Step 4: Verify results in validator_hourly_archive
    const archivedData = await prisma.validatorHourlyArchive.findMany({
      where: { timestamp: hourStart },
      orderBy: { validatorIndex: 'asc' },
    });

    expect(archivedData.length).toBe(2);

    // Verify Validator 100
    const validator100 = archivedData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(validator100).toBeDefined();

    // Attestation counts: Validator 100 has 2 successful (delay 0, 3) and 2 missed (delay 6, NULL)
    // We insert data for 4 slots: testSlots[0] (delay=0), testSlots[1] (delay=3), testSlots[2] (delay=6), testSlots[3] (NULL)
    // All 4 slots should be included since they are all < endSlot (exclusive)
    expect(validator100.attestationCount).toBe(2); // 2 successful (delay 0, 3)
    // Missed count should be 2 (slots with delay 6 and NULL)
    expect(validator100.missedAttestationCount).toBe(2);

    // Rewards: sync is temporarily disabled, exec=7000 (from slot 0), block=5000 (from slot 1)
    expect(validator100.syncRewardTotal).toBe(BigInt(0));
    expect(validator100.execRewardTotal?.toString()).toBe('7000');
    expect(validator100.blockRewardTotal).toBe(BigInt(5000));

    // CL rewards: epoch 0 (100+200+300+50=650), epoch 1 (150+250+350+75=825), total=1475
    expect(validator100.clRewardTotal).toBe(BigInt(1475));
    expect(validator100.clMissedRewardTotal).toBe(BigInt(0));

    // Verify Validator 200
    const validator200 = archivedData.find((d) => d.validatorIndex === VALIDATOR_2)!;
    expect(validator200).toBeDefined();

    // Attestation counts: all 4 successful (all delays <= 5)
    expect(validator200.attestationCount).toBe(4);
    expect(validator200.missedAttestationCount).toBeNull(); // NULL when 0 for storage optimization

    // Rewards: sync is temporarily disabled, exec=8000 (from slot 2), block=6000 (from slot 3)
    expect(validator200.syncRewardTotal).toBe(BigInt(0));
    expect(validator200.execRewardTotal?.toString()).toBe('8000');
    expect(validator200.blockRewardTotal).toBe(BigInt(6000));

    // CL rewards: epoch 0 (500+600+700+100=1900), epoch 1 (550+650+750+120=2070), total=3970
    // CL missed: epoch 0 (10+20+30+5=65), epoch 1 (15+25+35+8=83), total=148
    expect(validator200.clRewardTotal).toBe(BigInt(3970));
    expect(validator200.clMissedRewardTotal).toBe(BigInt(148));

    // Verify JSON data structures
    // Validator 100: data_by_slot should have 4 entries with variable-length tuples
    // Proposer slots → 5 elements, attestation-only → 2
    const validator100Slots = validator100.dataBySlot as Array<(number | string)[]>;
    expect(validator100Slots.length).toBe(4);

    // slot 0: proposer (exec_reward=7000), sync disabled → 5 elements with sync=0
    expect(validator100Slots[0]).toEqual([testSlots[0], 0, '0', '7000', '0']);

    // slot 1: proposer (block_reward=5000), sync disabled → 5 elements with sync=0
    expect(validator100Slots[1]).toEqual([testSlots[1], 3, '0', '0', '5000']);

    // slot 2: no sync, no proposer → 2 elements
    expect(validator100Slots[2]).toEqual([testSlots[2], 6]);

    // slot 3: no attestation, no sync, no proposer → 2 elements
    expect(validator100Slots[3]).toEqual([testSlots[3], -1]);

    // Validator 100: data_by_epoch should have 2 entries
    const validator100Epochs = validator100.dataByEpoch as Array<
      [number, string, string, string, string, string, string, string, string]
    >;
    expect(validator100Epochs.length).toBe(2);
    expect(validator100Epochs[0][0]).toBe(testEpochs[0]); // epoch
    expect(validator100Epochs[0][1]).toBe('100'); // head
    expect(validator100Epochs[0][2]).toBe('200'); // target
    expect(validator100Epochs[0][3]).toBe('300'); // source
    expect(validator100Epochs[0][4]).toBe('50'); // inactivity

    // Step 5: Verify partitions were dropped and archive partition was created
    const committeePartitionsAfter = await partitionStorage.discoverPartitions(
      PARTITION_TABLE_NAMES.COMMITTEE,
    );
    const epochRewardsPartitionsAfter = await partitionStorage.discoverPartitions(
      PARTITION_TABLE_NAMES.EPOCH_REWARDS,
    );

    // The partitions should be dropped (check the specific partition names we created)
    const createdCommitteePartition = committeePartitions[0];
    const createdEpochRewardsPartition = epochRewardsPartitions[0];

    // Verify the specific partitions we created are no longer present
    expect(committeePartitionsAfter).not.toContain(createdCommitteePartition);
    expect(epochRewardsPartitionsAfter).not.toContain(createdEpochRewardsPartition);

    // Verify archive partition was created with the specific name
    const expectedArchivePartitionName = getHourlyArchivePartitionName(
      'validator_hourly_archive',
      hourStart,
    );
    const archivePartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename 
      FROM pg_tables 
      WHERE tablename = ${expectedArchivePartitionName}
    `;
    expect(archivePartitions.length).toBe(1);
    expect(archivePartitions[0].tablename).toBe(expectedArchivePartitionName);
  });

  it('should not count rewards as missed attestations when validator has no attestation duty for that slot but receives rewards', async () => {
    // attestation counts if the validator doesn't have attestation duty in that slot

    // Step 1: Create partitions
    await partitionController.createPartitionForCommittee(TEST_EPOCH_1);
    await partitionController.createPartitionForEpochRewards(TEST_EPOCH_1);

    const committeePartitions = await partitionStorage.discoverPartitions(
      PARTITION_TABLE_NAMES.COMMITTEE,
    );
    const epochRewardsPartitions = await partitionStorage.discoverPartitions(
      PARTITION_TABLE_NAMES.EPOCH_REWARDS,
    );

    const committeePartition = parseSlotPartitionName(committeePartitions[0]);
    const epochRewardsPartition = parseEpochPartitionName(epochRewardsPartitions[0]);

    testSlots = [
      committeePartition!.start,
      committeePartition!.start + 1,
      committeePartition!.start + 2,
    ];
    testEpochs = [epochRewardsPartition!.start];
    hourStart = committeePartition!.datetime!;

    const candidate = await partitionController.getHourToArchive();
    expect(candidate).not.toBeNull();
    expect(candidate?.hourStart).toStrictEqual(hourStart);

    // Scenario: Validator 300 has NO attestation duty in any slot
    // and proposes blocks in the hour
    const VALIDATOR_3 = 300;

    // Insert block reward (consensusReward) and execution reward for validator 300
    // BUT validator 300 has NO entry in committee table (no attestation duty)
    await prisma.slot.createMany({
      skipDuplicates: true,
      data: [
        {
          slot: testSlots[0],
          processed: true,
        },
        {
          slot: testSlots[1],
          proposerIndex: VALIDATOR_3,
          consensusReward: BigInt(10000),
          processed: true,
        },
        {
          slot: testSlots[2],
          proposerIndex: VALIDATOR_3,
          executionReward: '15000',
          processed: true,
        },
        {
          slot: candidate!.endSlot,
          processed: true,
        },
      ],
    });

    // Insert epoch rewards for validator 300
    await prisma.epochRewards.createMany({
      data: [
        {
          epoch: testEpochs[0],
          validatorIndex: VALIDATOR_3,
          head: BigInt(1000),
          target: BigInt(2000),
          source: BigInt(3000),
          inactivity: BigInt(500),
          missedHead: BigInt(0),
          missedTarget: BigInt(0),
          missedSource: BigInt(0),
          missedInactivity: BigInt(0),
        },
      ],
    });

    await prisma.epoch.createMany({
      skipDuplicates: true,
      data: [
        ...testEpochs.map((epoch) => ({
          epoch,
          processed: true,
        })),
        {
          epoch: candidate!.endEpoch,
          processed: true,
        },
      ],
    });

    // Execute archive
    const archivedHour = await hourlyArchiveController.archive();
    expect(archivedHour).not.toBeNull();

    // Verify results
    const archivedData = await prisma.validatorHourlyArchive.findMany({
      where: { timestamp: hourStart, validatorIndex: VALIDATOR_3 },
      orderBy: { validatorIndex: 'asc' },
    });

    const validator300 = archivedData.find((d) => d.validatorIndex === VALIDATOR_3);
    expect(validator300).toBeDefined();

    // CRITICAL: Validator 300 has NO attestation duty, so counts should be 0
    // This is the bug fix - rewards should NOT count as missed attestations
    expect(validator300!.attestationCount).toBe(0);
    expect(validator300!.missedAttestationCount).toBeNull(); // NULL when 0 for storage optimization

    // But rewards should still be aggregated correctly
    expect(validator300!.syncRewardTotal).toBe(BigInt(0));
    expect(validator300!.blockRewardTotal).toBe(BigInt(10000));
    expect(validator300!.execRewardTotal?.toString()).toBe('15000');
    expect(validator300!.clRewardTotal).toBe(BigInt(6500)); // 1000+2000+3000+500
  });
});
