import fs from 'fs';
import path from 'path';

import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, vi, type MockedFunction } from 'vitest';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { GetValidators } from '@/src/services/consensus/types.js';

// Mock data file
const MOCK_PATH = path.join(__dirname, 'mocks/validators.json');

describe('Validators E2E Tests', () => {
  let prisma: PrismaClient;
  let validatorsStorage: ValidatorsStorage;
  let validatorsController: ValidatorsController;
  let mockBeaconClient: Pick<BeaconClient, 'getValidators'>;

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
    validatorsStorage = new ValidatorsStorage(prisma);

    // Mock BeaconClient
    mockBeaconClient = {
      getValidators: vi.fn() as MockedFunction<BeaconClient['getValidators']>,
    };

    validatorsController = new ValidatorsController(
      mockBeaconClient as BeaconClient,
      validatorsStorage,
    );

    // Clean database before tests
    await prisma.validator.deleteMany();
  });

  afterAll(async () => {
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
      await validatorsController.initValidators();

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
});
