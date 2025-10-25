import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Import mock data
import committeeData from './mocks/committee_1529347.json' with { type: 'json' };
import rewardsAttestations1525790 from './mocks/rewardsAttestations_1525790.json' with { type: 'json' };
import rewardsAttestations1525791 from './mocks/rewardsAttestations_1525791.json' with { type: 'json' };
import syncCommitteeData from './mocks/syncCommittee_1529347.json' with { type: 'json' };
import validatorsData from './mocks/validators.json' with { type: 'json' };

import { gnosisConfig } from '@/src/config/chain.js';
import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { ValidatorControllerHelpers } from '@/src/services/consensus/controllers/helpers/validatorControllerHelpers.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { GetCommittees } from '@/src/services/consensus/types.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';

/**
 * Note: Mocked data from this tests was taken from Gnosis chain.
 */
describe('Epoch Processor E2E Tests', () => {
  let prisma: PrismaClient;
  let epochStorage: EpochStorage;
  let validatorsStorage: ValidatorsStorage;
  let epochController: EpochController;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    validatorsStorage = new ValidatorsStorage(prisma);
    epochStorage = new EpochStorage(prisma, validatorsStorage);

    epochController = new EpochController(
      { slotStartIndexing: 32000 } as BeaconClient,
      epochStorage,
      validatorsStorage,
      new BeaconTime({
        genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
        slotDurationMs: gnosisConfig.beacon.slotDuration,
        slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
        epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
        slotStartIndexing: 32000,
      }),
    );

    await prisma.epoch.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Controller helpers', () => {
    beforeEach(async () => {
      await prisma.epoch.deleteMany();
    });

    it('getMaxEpoch: returns null when empty and max when data exists', async () => {
      const emptyMax = await epochController.getMaxEpoch();
      expect(emptyMax).toBeNull();

      await epochStorage.createEpochs([1000, 1001, 1002]);
      const max = await epochController.getMaxEpoch();
      expect(max).toBe(1002);
    });

    it('getMinEpochToProcess: returns the smallest unprocessed epoch', async () => {
      await epochStorage.createEpochs([1000, 1001, 1002]);

      const min1 = await epochController.getMinEpochToProcess();
      expect(min1?.epoch).toBe(1000);
      expect(min1?.processed).toBe(false);

      await epochController.markEpochAsProcessed(1000);
      const min2 = await epochController.getMinEpochToProcess();
      expect(min2?.epoch).toBe(1001);
      expect(min2?.processed).toBe(false);

      await epochController.markEpochAsProcessed(1001);
      await epochController.markEpochAsProcessed(1002);
      const min3 = await epochController.getMinEpochToProcess();
      expect(min3).toBeNull();
    });

    it('markEpochAsProcessed: updates processed flag and shifts next min', async () => {
      await epochStorage.createEpochs([2000, 2001, 2002]);

      let min = await epochController.getMinEpochToProcess();
      expect(min?.epoch).toBe(2000);

      await epochController.markEpochAsProcessed(2000);
      const updated = await epochController.getEpochByNumber(2000);
      expect(updated?.processed).toBe(true);

      min = await epochController.getMinEpochToProcess();
      expect(min?.epoch).toBe(2001);
      expect(min?.processed).toBe(false);
    });

    it('getUnprocessedCount: counts epochs with any pending work', async () => {
      await epochStorage.createEpochs([3000, 3001, 3002]);
      const count = await epochController.getUnprocessedCount();
      expect(count).toBe(3);
    });

    // /eth/v1/beacon/rewards/attestations/1525790
    // /eth/v1/beacon/states/24412640/validators
    // ["549417","549418","549419","549046"]
  });

  describe('fetchEpochRewards', () => {
    let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'> & {
      getAttestationRewards: ReturnType<typeof vi.fn>;
    };
    let epochControllerWithMock: EpochController;

    beforeEach(async () => {
      // Clean up database
      await prisma.hourlyValidatorStats.deleteMany();
      await prisma.hourlyValidatorData.deleteMany();
      await prisma.validator.deleteMany();
      await prisma.epoch.deleteMany();

      // Create mock beacon client
      mockBeaconClient = {
        slotStartIndexing: 32000,
        getAttestationRewards: vi.fn(),
      };

      // Create epoch controller with mock
      epochControllerWithMock = new EpochController(
        mockBeaconClient as unknown as BeaconClient,
        epochStorage,
        validatorsStorage,
        new BeaconTime({
          genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
          slotDurationMs: gnosisConfig.beacon.slotDuration,
          slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
          epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
          slotStartIndexing: 32000,
        }),
      );

      // Save validators data to database
      const validators = validatorsData.data.map((v) =>
        ValidatorControllerHelpers.mapValidatorDataToDBEntity(v),
      );
      await validatorsStorage.saveValidators(validators);

      // Create epochs
      await epochStorage.createEpochs([1525790, 1525791, 1525792, 1525793]);
    });

    it('should process both epochs and verify HourlyValidatorData and HourlyValidatorStats', async () => {
      // Process epoch 1525790
      mockBeaconClient.getAttestationRewards.mockResolvedValueOnce(rewardsAttestations1525790);
      await epochControllerWithMock.fetchEpochRewards(1525790);
      const epoch1525790 = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epoch1525790?.rewardsFetched).toBe(true);

      // Process epoch 1525791
      mockBeaconClient.getAttestationRewards.mockResolvedValueOnce(rewardsAttestations1525791);
      await epochControllerWithMock.fetchEpochRewards(1525791);
      const epoch1525791 = await epochControllerWithMock.getEpochByNumber(1525791);
      expect(epoch1525791?.rewardsFetched).toBe(true);

      // Expected datetime for both epochs (should be 2025-10-21T14:00:00.000Z)
      const expectedDatetime = new Date('2025-10-21T14:00:00.000Z');

      // Fetch validators data and stas from  database
      const validatorIndexes = [549417, 549418, 549419];
      const dbHourlyData = await prisma.hourlyValidatorData.findMany({
        where: {
          validatorIndex: { in: validatorIndexes },
        },
      });
      const dbHourlyStats = await prisma.hourlyValidatorStats.findMany({
        where: {
          validatorIndex: { in: validatorIndexes },
        },
      });

      expect(dbHourlyData.length).toBeGreaterThan(0);

      // Verify validator 549417
      const data549417 = dbHourlyData.find((d) => d.validatorIndex === 549417);
      expect(data549417!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      expect(data549417!.epochRewards).toBe(
        '1525790:87524:163524:87929:0:0:0:0:0,1525791:87314:163553:87978:0:0:0:0:0',
      );

      // Verify validator 549418
      const data549418 = dbHourlyData.find((d) => d.validatorIndex === 549418);
      expect(data549418!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      expect(data549418!.epochRewards).toBe(
        '1525790:87524:163524:87929:0:0:0:0:0,1525791:87314:163553:87978:0:0:0:0:0',
      );

      // Verify validator 549419
      const data549419 = dbHourlyData.find((d) => d.validatorIndex === 549419);
      expect(data549419!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      expect(data549419!.epochRewards).toBe(
        '1525790:37711:70458:37886:0:0:0:0:0,1525791:37621:70470:37907:0:0:0:0:0',
      );

      expect(dbHourlyStats.length).toBeGreaterThan(0);

      // Verify validator 549417 stats
      const stats549417 = dbHourlyStats.find((s) => s.validatorIndex === 549417);
      expect(stats549417!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      // Verify validator 549417 rewards (87524+163524+87929+0) + (87314+163553+87978+0) = 338977 + 338845 = 677822
      expect(Number(stats549417!.clRewards?.toString())).toBe(677822);

      // Verify validator 549418 stats
      const stats549418 = dbHourlyStats.find((s) => s.validatorIndex === 549418);
      expect(stats549418!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      // Verify validator 549418 rewards (same as 549417)
      expect(Number(stats549418!.clRewards?.toString())).toBe(677822);

      // Verify validator 549419 stats
      const stats549419 = dbHourlyStats.find((s) => s.validatorIndex === 549419);
      expect(stats549419!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      // Verify validator 549419 rewards (37711+70458+37886+0) + (37621+70470+37907+0) = 146055 + 145998 = 292053
      expect(Number(stats549419!.clRewards?.toString())).toBe(292053);
    });
  });

  describe('fetchCommittees', () => {
    let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'> & {
      getCommittees: ReturnType<typeof vi.fn>;
    };
    let epochControllerWithMock: EpochController;

    beforeEach(async () => {
      // Clean up database (order matters due to foreign key constraints)
      await prisma.committee.deleteMany();
      await prisma.slot.deleteMany();
      await prisma.epoch.deleteMany();

      // Create mock beacon client
      mockBeaconClient = {
        slotStartIndexing: 32000,
        getCommittees: vi.fn(),
      };

      // Create epoch controller with mock
      epochControllerWithMock = new EpochController(
        mockBeaconClient as unknown as BeaconClient,
        epochStorage,
        validatorsStorage,
        new BeaconTime({
          genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
          slotDurationMs: gnosisConfig.beacon.slotDuration,
          slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
          epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
          slotStartIndexing: 32000,
        }),
      );

      // Create epoch
      await epochStorage.createEpochs([1529347]);
    });

    it('should throw error if committees already fetched', async () => {
      // Mark epoch as committeesFetched using epochStorage
      await epochStorage.updateCommitteesFetched(1529347);

      // Should throw error
      await expect(epochControllerWithMock.fetchCommittees(1529347)).rejects.toThrow(
        'Committees for epoch 1529347 already fetched',
      );
    });

    it('should process committees and verify complete flow', async () => {
      // Use the existing GetCommittees type for better type safety
      const committeeDataTyped = committeeData as GetCommittees;
      mockBeaconClient.getCommittees.mockResolvedValueOnce(committeeDataTyped.data);

      // Process committees
      await epochControllerWithMock.fetchCommittees(1529347);

      const epoch = await epochControllerWithMock.getEpochByNumber(1529347);
      expect(epoch?.committeesFetched).toBe(true);

      // ===== VERIFY SPECIFIC VALIDATOR POSITIONS =====
      // Validator 549417 should be in index 37, slot 24469567
      const committees549417 = await epochStorage.getCommitteesBySlots([24469567]);
      const committee549417 = committees549417.find(
        (c) => c.index === 37 && c.validatorIndex === 549417,
      );
      expect(committee549417?.validatorIndex).toBe(549417);

      // Validator 549418 should be in index 48, slot 24469564
      const committees549418 = await epochStorage.getCommitteesBySlots([24469564]);
      const committee549418 = committees549418.find(
        (c) => c.index === 48 && c.validatorIndex === 549418,
      );
      expect(committee549418?.validatorIndex).toBe(549418);

      // Validator 549419 should be in index 36, slot 24469564
      const committees549419 = await epochStorage.getCommitteesBySlots([24469564]);
      const committee549419 = committees549419.find(
        (c) => c.index === 36 && c.validatorIndex === 549419,
      );
      expect(committee549419?.validatorIndex).toBe(549419);

      // ===== VERIFY EPOCH SLOTS RANGE =====
      const epochSlots = epochControllerWithMock.getBeaconTime().getEpochSlots(1529347);
      const expectedStartSlot = epochSlots.startSlot;
      const expectedEndSlot = epochSlots.endSlot;

      // Calculate all slots for the epoch
      const epochSlotsArray = [];
      for (let slot = expectedStartSlot; slot <= expectedEndSlot; slot++) {
        epochSlotsArray.push(slot);
      }
      expect(epochSlotsArray.length).toBe(expectedEndSlot - expectedStartSlot + 1);

      // Get all committees for the epoch using the calculated slots
      const committees = await epochStorage.getCommitteesBySlots(epochSlotsArray);

      // Get unique slots from committees
      const uniqueSlots = [...new Set(committees.map((c) => c.slot))].sort((a, b) => a - b);

      // Verify all expected slots were created
      expect(uniqueSlots.length).toBe(epochSlotsArray.length);
      for (const expectedSlot of epochSlotsArray) {
        expect(uniqueSlots).toContain(expectedSlot);
      }

      // Verify each committee has valid data
      for (const committee of committees) {
        expect(committee.validatorIndex).toBeGreaterThan(0);
        expect(committee.slot).toBeGreaterThan(0);
        expect(committee.index).toBeGreaterThanOrEqual(0);
        expect(committee.index).toBeLessThan(64);
        expect(committee.aggregationBitsIndex).toBeGreaterThanOrEqual(0);
      }

      // Verify total committees count: 64 indices × 16 slots = 1024 committees
      // Each committee has multiple validators, so we need to count unique (slot, index) combinations
      const uniqueCommittees = new Set(committees.map((c) => `${c.slot}-${c.index}`));
      expect(uniqueCommittees.size).toBe(1024);

      // Verify total validators count across all committees: 268434
      expect(committees.length).toBe(268434);

      // Verify each slot has 64 committees (indices 0-63)
      for (const slot of uniqueSlots) {
        const slotCommittees = committees.filter((c) => c.slot === slot);
        const uniqueSlotCommittees = new Set(slotCommittees.map((c) => c.index));
        expect(uniqueSlotCommittees.size).toBe(64);
      }

      const committee549417InList = committees.find(
        (c) => c.slot === 24469567 && c.index === 37 && c.validatorIndex === 549417,
      );
      expect(committee549417InList).toBeTruthy();

      const committee549418InList = committees.find(
        (c) => c.slot === 24469564 && c.index === 48 && c.validatorIndex === 549418,
      );
      expect(committee549418InList).toBeTruthy();

      const committee549419InList = committees.find(
        (c) => c.slot === 24469564 && c.index === 36 && c.validatorIndex === 549419,
      );
      expect(committee549419InList).toBeTruthy();
    });
  });

  describe('fetchSyncCommittees', () => {
    let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'> & {
      getSyncCommittees: ReturnType<typeof vi.fn>;
    };
    let epochControllerWithMock: EpochController;

    beforeEach(async () => {
      // Clean up database (order matters due to foreign key constraints)
      await prisma.syncCommittee.deleteMany();
      await prisma.epoch.deleteMany();

      // Create mock beacon client
      mockBeaconClient = {
        slotStartIndexing: 32000,
        getSyncCommittees: vi.fn(),
      };

      // Create epoch controller with mock
      epochControllerWithMock = new EpochController(
        mockBeaconClient as unknown as BeaconClient,
        epochStorage,
        validatorsStorage,
        new BeaconTime({
          genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
          slotDurationMs: gnosisConfig.beacon.slotDuration,
          slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
          epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
          slotStartIndexing: 32000,
        }),
      );

      // Create epoch
      await epochStorage.createEpochs([1529347]);
    });

    it('should throw error if sync committees already fetched', async () => {
      await epochStorage.updateSyncCommitteesFetched(1529347);
      await expect(epochControllerWithMock.fetchSyncCommittees(1529347)).rejects.toThrow();
    });

    it('should process sync committees and verify complete flow', async () => {
      // Mock the sync committee data response
      mockBeaconClient.getSyncCommittees.mockResolvedValueOnce(syncCommitteeData.data);

      // Process sync committees
      await epochControllerWithMock.fetchSyncCommittees(1529347);

      const epoch = await epochControllerWithMock.getEpochByNumber(1529347);
      expect(epoch?.syncCommitteesFetched).toBe(true);

      const syncCommittees = await prisma.syncCommittee.findMany();
      const syncCommittee = syncCommittees[0];

      // Get the sync committee for this epoch period
      expect(syncCommittee.validators).toBeDefined();
      expect(syncCommittee.validatorAggregates).toBeDefined();
      expect(Array.isArray(syncCommittee.validators)).toBe(true);
      expect(Array.isArray(syncCommittee.validatorAggregates)).toBe(true);

      // Verify the sync committee
      const validators = syncCommittee.validators as string[];
      expect(validators.length).toBe(512);
      expect(validators).toContain('488331');
      expect(validators).toContain('230784');
      expect(validators).toContain('548264');
      expect(validators).toContain('310388');

      const validatorAggregates = syncCommittee.validatorAggregates as string[][];
      expect(validatorAggregates.length).toBe(4);

      // Verify validator aggregates structure and first validators match JSON
      expect(validatorAggregates[0][0]).toBe('488331');
      expect(validatorAggregates[1][0]).toBe('470386');
      expect(validatorAggregates[2][0]).toBe('239224');
      expect(validatorAggregates[3][0]).toBe('542886');

      for (const aggregate of validatorAggregates) {
        expect(Array.isArray(aggregate)).toBe(true);
        expect(aggregate.length).toBeGreaterThan(0);
        // Each aggregate should contain validator IDs as strings
        for (const validatorId of aggregate) {
          expect(typeof validatorId).toBe('string');
          expect(validatorId).toMatch(/^\d+$/); // Should be numeric string
        }
      }

      // Verify epoch range is correct (sync committee period covers 256 epochs)
      expect(syncCommittee.fromEpoch).toBe(1529344);
      expect(syncCommittee.toEpoch).toBe(1529599);

      // Verify that checkSyncCommitteeForEpoch returns true
      const checkResult = await epochControllerWithMock.checkSyncCommitteeForEpoch(1529347);
      expect(checkResult.isFetched).toBe(true);
    });
  });
});
