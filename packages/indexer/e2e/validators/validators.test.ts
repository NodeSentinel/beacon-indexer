import fs from 'fs';
import path from 'path';

import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
  type MockedFunction,
} from 'vitest';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { GetValidators } from '@/src/services/consensus/types.js';

// Mock data file
const MOCK_PATH = path.join(__dirname, 'mocks/validators.json');

// Test constants for BeaconTime
const TEST_LOOKBACK_SLOT = 0;

describe('Validators E2E Tests', () => {
  let prisma: PrismaClient;
  let validatorsStorage: ValidatorsStorage;
  let validatorsController: ValidatorsController;
  let mockBeaconClient: Pick<BeaconClient, 'getValidators'>;
  let beaconTime: BeaconTime;

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

    // Initialize storage and controller
    validatorsStorage = new ValidatorsStorage(prisma, process.env.DATABASE_URL!);

    // Create BeaconTime instance for tests using Gnosis configuration
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: TEST_LOOKBACK_SLOT,
    });

    // Mock BeaconClient
    mockBeaconClient = {
      getValidators: vi.fn() as MockedFunction<BeaconClient['getValidators']>,
    };

    validatorsController = new ValidatorsController(
      mockBeaconClient as BeaconClient,
      validatorsStorage,
      beaconTime,
    );

    // Clean database before tests
    await prisma.validator.deleteMany();
  });

  afterAll(async () => {
    await ValidatorsStorage.closePgPool();
    await prisma.$disconnect();
  });

  describe('Validator Creation', () => {
    beforeAll(async () => {
      // Clean database before tests
      await prisma.validator.deleteMany();

      // Load mock data
      const mockData = JSON.parse(fs.readFileSync(MOCK_PATH, 'utf8')) as GetValidators;
      (
        mockBeaconClient.getValidators as MockedFunction<BeaconClient['getValidators']>
      ).mockResolvedValue(mockData.data);
    });

    it('should initialize validators successfully', async () => {
      await validatorsController.initValidatorsWithWait(TEST_LOOKBACK_SLOT);

      const count = await validatorsStorage.getValidatorsCount();
      expect(count).toBe(6);
    });

    it('should save and retrieve validator data correctly', async () => {
      // Test validator with index 10001
      const validator2 = await validatorsStorage.getValidatorById(10001);
      expect(validator2).toBeTruthy();
      expect(validator2?.id).toBe(10001);
      expect(validator2?.status).toBe(2);
      expect(validator2?.balance.toString()).toBe('32019036041');
      expect(validator2?.effectiveBalance?.toString()).toBe('32000000000');

      // Test validator with index 10005
      const validator5 = await validatorsStorage.getValidatorById(10005);
      expect(validator5).toBeTruthy();
      expect(validator5?.id).toBe(10005);
      expect(validator5?.status).toBe(2);
      expect(validator5?.balance.toString()).toBe('32018977816');
      expect(validator5?.effectiveBalance?.toString()).toBe('32000000000');
    });

    it('should handle validators with different statuses', async () => {
      // Test validator with withdrawal_done status (index 10000)
      const validatorWithdrawn = await validatorsStorage.getValidatorById(10000);
      expect(validatorWithdrawn).toBeTruthy();
      expect(validatorWithdrawn?.id).toBe(10000);
      expect(validatorWithdrawn?.status).toBe(8);
      expect(validatorWithdrawn?.balance.toString()).toBe('0');
    });
  });

  // This scenario covers the epoch refresh path that now uses the full validators
  // endpoint and must keep validator state in sync for existing rows.
  describe('Epoch validator refresh', () => {
    beforeEach(async () => {
      // Reset epoch and validator state so the test controls every input row.
      await prisma.epoch.deleteMany();
      await prisma.validator.deleteMany();

      // Clear any previous mock calls and return values before the next scenario.
      vi.clearAllMocks();
    });

    it('should refresh full validator state for an epoch and mark the epoch as fetched', async () => {
      // Create one existing validator row with stale values so the epoch refresh
      // must update the persisted state in place.
      await prisma.validator.create({
        data: {
          id: 1,
          status: 2,
          balance: BigInt(32_000_000_000),
          effectiveBalance: BigInt(32_000_000_000),
          activationEpoch: 5,
          pubkey: '0x01',
          withdrawalAddress: '0x1111111111111111111111111111111111111111',
        },
      });

      // Create the epoch row that the refresh flow marks as fetched when the
      // validator batch is stored successfully.
      await prisma.epoch.create({
        data: {
          epoch: 123,
        },
      });

      // Return the full validator payload the new epoch refresh path expects.
      (
        mockBeaconClient.getValidators as MockedFunction<BeaconClient['getValidators']>
      ).mockResolvedValue([
        {
          index: '1',
          balance: '31900000000',
          status: 'active_exiting',
          validator: {
            pubkey: '0x01',
            withdrawal_credentials:
              '0x0100000000000000000000002222222222222222222222222222222222222222',
            effective_balance: '31000000000',
            slashed: 'false',
            activation_eligibility_epoch: '0',
            activation_epoch: '10',
            exit_epoch: '18446744073709551615',
            withdrawable_epoch: '18446744073709551615',
          },
        },
      ] as GetValidators['data']);

      // Run the epoch refresh path that used to update only balance.
      await validatorsController.fetchValidatorsBalances(TEST_LOOKBACK_SLOT, 123);

      // Read the validator back from the database after the epoch refresh.
      const validator = await prisma.validator.findUniqueOrThrow({
        where: { id: 1 },
      });

      // Read the epoch row back to confirm the fetch flag was updated too.
      const epoch = await prisma.epoch.findUniqueOrThrow({
        where: { epoch: 123 },
      });

      // The refresh must update all validator fields coming from the full endpoint.
      expect(validator.balance.toString()).toBe('31900000000');
      expect(validator.effectiveBalance?.toString()).toBe('31000000000');
      expect(validator.status).toBe(3);
      expect(validator.withdrawalAddress).toBe('0x2222222222222222222222222222222222222222');
      expect(validator.activationEpoch).toBe(10);

      // The epoch row should reflect that the validator batch finished successfully.
      expect(epoch.validatorsBalancesFetched).toBe(true);
    });
  });
});
