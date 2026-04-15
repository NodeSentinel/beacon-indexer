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

  // These scenarios cover the storage methods that update existing validator
  // rows from the Beacon API validator payload.
  describe('Validator updates', () => {
    beforeEach(async () => {
      // Reset epoch and validator state so each scenario controls every row.
      await prisma.epoch.deleteMany();
      await prisma.validator.deleteMany();
    });

    // This test verifies that the epoch-specific storage method updates the
    // existing validator row and marks the epoch batch as fetched.
    it('should update validators and mark the epoch when saveValidatorsForEpoch runs', async () => {
      // Create one existing validator row with stale values so the storage
      // method must rewrite the persisted state in place.
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

      // Create the epoch row that the storage method should mark as fetched.
      await prisma.epoch.create({
        data: {
          epoch: 123,
        },
      });

      // Build the full validator payload that should replace the stale row.
      const validatorsData: GetValidators['data'] = [
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
      ];

      // Run the epoch-aware storage path directly.
      await validatorsStorage.saveValidatorsForEpoch(validatorsData, 123);

      // Read the validator back from the database after the update.
      const validator = await prisma.validator.findUniqueOrThrow({
        where: { id: 1 },
      });

      // Read the epoch row back to confirm the fetch flag changed too.
      const epoch = await prisma.epoch.findUniqueOrThrow({
        where: { epoch: 123 },
      });

      // The validator row should reflect the full Beacon API payload.
      expect(validator.balance.toString()).toBe('31900000000');
      expect(validator.effectiveBalance?.toString()).toBe('31000000000');
      expect(validator.status).toBe(3);
      expect(validator.withdrawalAddress).toBe('0x2222222222222222222222222222222222222222');
      expect(validator.activationEpoch).toBe(10);

      // The epoch row should reflect that the batch finished successfully.
      expect(epoch.validatorsBalancesFetched).toBe(true);
    });

    // This test verifies that the generic validator update path updates only the
    // validator row and does not depend on any epoch state.
    it('should update validators when updateValidators runs', async () => {
      // Create one existing validator row with stale values.
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

      // Build the full validator payload that should replace the stale row.
      const validatorsData: GetValidators['data'] = [
        {
          index: '1',
          balance: '31800000000',
          status: 'active_slashed',
          validator: {
            pubkey: '0x01',
            withdrawal_credentials:
              '0x0100000000000000000000003333333333333333333333333333333333333333',
            effective_balance: '30000000000',
            slashed: 'true',
            activation_eligibility_epoch: '0',
            activation_epoch: '11',
            exit_epoch: '18446744073709551615',
            withdrawable_epoch: '18446744073709551615',
          },
        },
      ];

      // Run the generic validator update path directly.
      await validatorsStorage.updateValidators(validatorsData);

      // Read the validator back from the database after the update.
      const validator = await prisma.validator.findUniqueOrThrow({
        where: { id: 1 },
      });

      // The validator row should reflect the full Beacon API payload.
      expect(validator.balance.toString()).toBe('31800000000');
      expect(validator.effectiveBalance?.toString()).toBe('30000000000');
      expect(validator.status).toBe(4);
      expect(validator.withdrawalAddress).toBe('0x3333333333333333333333333333333333333333');
      expect(validator.activationEpoch).toBe(11);
    });
  });
});
