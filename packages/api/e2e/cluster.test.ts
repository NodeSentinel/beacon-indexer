import { createServer } from 'node:http';

import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type {
  Cluster,
  ClusterDetail,
  ClusterWithCount,
  AddValidatorsResponse as AddValidatorsData,
} from '@/routers/cluster/schemas.js';
import { createHttpServer } from '@/server.js';
import type { ApiResponse } from '@/utils/response.js';

// Response types using ApiResponse wrapper with schema types
type ClusterResponse = ApiResponse<Cluster>;
type ClusterDetailResponse = ApiResponse<ClusterDetail>;
type ClusterListResponse = ApiResponse<ClusterWithCount[]>;
type AddValidatorsResponse = ApiResponse<AddValidatorsData>;
type DeleteResponse = ApiResponse<{ deleted: boolean }>;
type RemoveValidatorResponse = ApiResponse<{ removed: boolean }>;
type RemoveValidatorsByAddressResponse = ApiResponse<{ removed: number }>;

describe('Cluster API E2E Tests', () => {
  let prisma: PrismaClient;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  const testOwnerId = '123456789';
  const createdClusterIds: string[] = [];

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

    await prisma.$connect();

    // Ensure a test user exists for the foreign key constraint
    await prisma.user.upsert({
      where: { id: BigInt(testOwnerId) },
      update: {},
      create: {
        id: BigInt(testOwnerId),
        userId: BigInt(testOwnerId),
        username: `test_user_${testOwnerId}`,
      },
    });

    server = createHttpServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    // Clean up created clusters after each test
    for (const id of createdClusterIds) {
      try {
        await prisma.cluster.delete({ where: { id } });
      } catch {
        // Ignore if already deleted
      }
    }
    createdClusterIds.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await prisma.$disconnect();
  });

  describe('POST /clusters', () => {
    it('should create a cluster successfully', async () => {
      const response = await fetch(`${baseUrl}/clusters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Cluster',
          visibility: 'private',
          ownerId: testOwnerId,
        }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data!.name).toBe('Test Cluster');
      expect(body.data!.visibility).toBe('private');
      expect(body.data!.ownerId).toBe(testOwnerId);
      expect(body.data!.id).toBeDefined();

      createdClusterIds.push(body.data!.id);
    });

    it('should create a cluster with feeRecipientAddress', async () => {
      const feeRecipient = '0x1234567890123456789012345678901234567890';
      const response = await fetch(`${baseUrl}/clusters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Cluster with Fee',
          visibility: 'shared',
          feeRecipientAddress: feeRecipient,
          ownerId: testOwnerId,
        }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      expect(body.success).toBe(true);
      expect(body.data!.feeRecipientAddress).toBe(feeRecipient);
      expect(body.data!.visibility).toBe('shared');

      createdClusterIds.push(body.data!.id);
    });

    it('should fail with empty name', async () => {
      const response = await fetch(`${baseUrl}/clusters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '',
          ownerId: testOwnerId,
        }),
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('GET /clusters', () => {
    it('should list clusters by ownerId', async () => {
      // Create two clusters first
      const cluster1 = await prisma.cluster.create({
        data: { name: 'List Test 1', ownerId: BigInt(testOwnerId), visibility: 'private' },
      });
      const cluster2 = await prisma.cluster.create({
        data: { name: 'List Test 2', ownerId: BigInt(testOwnerId), visibility: 'shared' },
      });
      createdClusterIds.push(cluster1.id, cluster2.id);

      const response = await fetch(`${baseUrl}/clusters?ownerId=${testOwnerId}`);

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterListResponse;

      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data!.length).toBeGreaterThanOrEqual(2);

      const names = body.data!.map((c) => c.name);
      expect(names).toContain('List Test 1');
      expect(names).toContain('List Test 2');
    });

    it('should return empty array for unknown owner', async () => {
      const response = await fetch(`${baseUrl}/clusters?ownerId=999999999`);

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterListResponse;

      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /clusters/:id', () => {
    it('should get cluster details with validators', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Get Test', ownerId: BigInt(testOwnerId), visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`);

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterDetailResponse;

      expect(body.success).toBe(true);
      expect(body.data!.id).toBe(cluster.id);
      expect(body.data!.name).toBe('Get Test');
      expect(body.data!.validators).toBeDefined();
      expect(body.data!.withdrawalAddresses).toBeDefined();
    });

    it('should return error for non-existent cluster', async () => {
      const response = await fetch(`${baseUrl}/clusters/non-existent-id`);

      expect(response.ok).toBe(true); // API returns 200 with error in body
      const body = (await response.json()) as ClusterResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');
    });
  });

  describe('PUT /clusters/:id', () => {
    it('should update cluster name', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Original Name', ownerId: BigInt(testOwnerId), visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      expect(body.success).toBe(true);
      expect(body.data!.name).toBe('Updated Name');
    });

    it('should update cluster visibility', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Visibility Test', ownerId: BigInt(testOwnerId), visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'shared' }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      expect(body.success).toBe(true);
      expect(body.data!.visibility).toBe('shared');
    });

    it('should return error for non-existent cluster', async () => {
      const response = await fetch(`${baseUrl}/clusters/non-existent-id`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');
    });
  });

  describe('DELETE /clusters/:id', () => {
    it('should delete cluster successfully', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Delete Test', ownerId: BigInt(testOwnerId), visibility: 'private' },
      });
      // Don't add to createdClusterIds since we're deleting it

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        method: 'DELETE',
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as DeleteResponse;

      expect(body.success).toBe(true);
      expect(body.data!.deleted).toBe(true);

      // Verify it's actually deleted
      const deleted = await prisma.cluster.findUnique({ where: { id: cluster.id } });
      expect(deleted).toBeNull();
    });

    it('should return error for non-existent cluster', async () => {
      const response = await fetch(`${baseUrl}/clusters/non-existent-id`, {
        method: 'DELETE',
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as DeleteResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');
    });
  });

  describe('POST /clusters/:id/validators', () => {
    it('should add validators to cluster', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Add Validators Test', ownerId: BigInt(testOwnerId), visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      // Ensure test validators exist
      await prisma.validator.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, balance: BigInt(32000000000) },
      });
      await prisma.validator.upsert({
        where: { id: 2 },
        update: {},
        create: { id: 2, balance: BigInt(32000000000) },
      });

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validatorIndexes: [1, 2] }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.added).toBe(2);
    });

    it('should handle duplicate validators (skipDuplicates)', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Duplicate Test', ownerId: BigInt(testOwnerId), visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      // Ensure test validator exists
      await prisma.validator.upsert({
        where: { id: 3 },
        update: {},
        create: { id: 3, balance: BigInt(32000000000) },
      });

      // Add validator first time
      await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validatorIndexes: [3] }),
      });

      // Add same validator again
      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validatorIndexes: [3] }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.added).toBe(0); // No new validators added
    });

    it('should return error for non-existent cluster', async () => {
      const response = await fetch(`${baseUrl}/clusters/non-existent-id/validators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validatorIndexes: [1] }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');
    });
  });

  describe('DELETE /clusters/:id/validators/:validatorIndex', () => {
    it('should remove validator from cluster', async () => {
      const cluster = await prisma.cluster.create({
        data: {
          name: 'Remove Validator Test',
          ownerId: BigInt(testOwnerId),
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      // Ensure test validator exists and add to cluster
      await prisma.validator.upsert({
        where: { id: 4 },
        update: {},
        create: { id: 4, balance: BigInt(32000000000) },
      });
      await prisma.clusterValidator.create({
        data: { clusterId: cluster.id, validatorIndex: 4 },
      });

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators/4`, {
        method: 'DELETE',
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorResponse;

      expect(body.success).toBe(true);
      expect(body.data!.removed).toBe(true);
    });

    it('should return error for validator not in cluster', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Not In Cluster Test', ownerId: BigInt(testOwnerId), visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators/999`, {
        method: 'DELETE',
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('VALIDATOR_NOT_IN_CLUSTER');
    });
  });

  describe('POST /clusters/:id/validators - validator validation', () => {
    it('should return error when validator index does not exist', async () => {
      const cluster = await prisma.cluster.create({
        data: {
          name: 'Validator Not Exists Test',
          ownerId: BigInt(testOwnerId),
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validatorIndexes: [999999] }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('VALIDATORS_NOT_FOUND');
      expect(body.error!.message).toContain('999999');
    });

    it('should return error when some validators do not exist', async () => {
      const cluster = await prisma.cluster.create({
        data: {
          name: 'Partial Validators Test',
          ownerId: BigInt(testOwnerId),
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      // Ensure one validator exists
      await prisma.validator.upsert({
        where: { id: 10 },
        update: {},
        create: { id: 10, balance: BigInt(32000000000) },
      });

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validatorIndexes: [10, 888888, 999999] }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('VALIDATORS_NOT_FOUND');
      expect(body.error!.message).toContain('888888');
      expect(body.error!.message).toContain('999999');
    });
  });

  describe('POST /clusters/:id/validators - by withdrawal address', () => {
    const testWithdrawalAddress = '0x1234567890123456789012345678901234567890';

    beforeAll(async () => {
      // Create validators with a specific withdrawal address
      await prisma.validator.upsert({
        where: { id: 100 },
        update: { withdrawalAddress: testWithdrawalAddress.toLowerCase() },
        create: {
          id: 100,
          balance: BigInt(32000000000),
          withdrawalAddress: testWithdrawalAddress.toLowerCase(),
        },
      });
      await prisma.validator.upsert({
        where: { id: 101 },
        update: { withdrawalAddress: testWithdrawalAddress.toLowerCase() },
        create: {
          id: 101,
          balance: BigInt(32000000000),
          withdrawalAddress: testWithdrawalAddress.toLowerCase(),
        },
      });
      await prisma.validator.upsert({
        where: { id: 102 },
        update: { withdrawalAddress: testWithdrawalAddress.toLowerCase() },
        create: {
          id: 102,
          balance: BigInt(32000000000),
          withdrawalAddress: testWithdrawalAddress.toLowerCase(),
        },
      });
    });

    it('should add all validators with withdrawal address', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Add By Address Test', ownerId: BigInt(testOwnerId), visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalAddress: testWithdrawalAddress }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.added).toBe(3);

      // Verify validators were added
      const clusterValidators = await prisma.clusterValidator.findMany({
        where: { clusterId: cluster.id },
      });
      expect(clusterValidators.length).toBe(3);
    });

    it('should be case-insensitive for withdrawal address', async () => {
      const cluster = await prisma.cluster.create({
        data: {
          name: 'Case Insensitive Test',
          ownerId: BigInt(testOwnerId),
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      // Use uppercase address
      const upperCaseAddress = testWithdrawalAddress.toUpperCase();

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalAddress: upperCaseAddress }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.added).toBe(3);
    });

    it('should return error for withdrawal address with no validators', async () => {
      const cluster = await prisma.cluster.create({
        data: {
          name: 'No Validators Address Test',
          ownerId: BigInt(testOwnerId),
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalAddress: '0x0000000000000000000000000000000000000000' }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('VALIDATORS_NOT_FOUND');
    });
  });

  describe('DELETE /clusters/:id/validators/by-address', () => {
    const testWithdrawalAddress = '0xabcdef1234567890abcdef1234567890abcdef12';

    beforeAll(async () => {
      // Create validators with a specific withdrawal address for removal tests
      await prisma.validator.upsert({
        where: { id: 200 },
        update: { withdrawalAddress: testWithdrawalAddress.toLowerCase() },
        create: {
          id: 200,
          balance: BigInt(32000000000),
          withdrawalAddress: testWithdrawalAddress.toLowerCase(),
        },
      });
      await prisma.validator.upsert({
        where: { id: 201 },
        update: { withdrawalAddress: testWithdrawalAddress.toLowerCase() },
        create: {
          id: 201,
          balance: BigInt(32000000000),
          withdrawalAddress: testWithdrawalAddress.toLowerCase(),
        },
      });
    });

    it('should remove all validators by withdrawal address', async () => {
      const cluster = await prisma.cluster.create({
        data: {
          name: 'Remove By Address Test',
          ownerId: BigInt(testOwnerId),
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      // Add validators to cluster first
      await prisma.clusterValidator.createMany({
        data: [
          { clusterId: cluster.id, validatorIndex: 200 },
          { clusterId: cluster.id, validatorIndex: 201 },
        ],
      });

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators/by-address`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalAddress: testWithdrawalAddress }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsByAddressResponse;

      expect(body.success).toBe(true);
      expect(body.data!.removed).toBe(2);

      // Verify validators were removed
      const clusterValidators = await prisma.clusterValidator.findMany({
        where: { clusterId: cluster.id },
      });
      expect(clusterValidators.length).toBe(0);
    });

    it('should be case-insensitive for removal', async () => {
      const cluster = await prisma.cluster.create({
        data: {
          name: 'Case Insensitive Remove Test',
          ownerId: BigInt(testOwnerId),
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      // Add validators to cluster
      await prisma.clusterValidator.createMany({
        data: [
          { clusterId: cluster.id, validatorIndex: 200 },
          { clusterId: cluster.id, validatorIndex: 201 },
        ],
      });

      // Use mixed case address
      const mixedCaseAddress = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators/by-address`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalAddress: mixedCaseAddress }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsByAddressResponse;

      expect(body.success).toBe(true);
      expect(body.data!.removed).toBe(2);
    });

    it('should return 0 removed when no validators match', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'No Match Remove Test', ownerId: BigInt(testOwnerId), visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators/by-address`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalAddress: '0x0000000000000000000000000000000000000000' }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsByAddressResponse;

      expect(body.success).toBe(true);
      expect(body.data!.removed).toBe(0);
    });

    it('should return error for non-existent cluster', async () => {
      const response = await fetch(`${baseUrl}/clusters/non-existent-id/validators/by-address`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalAddress: testWithdrawalAddress }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsByAddressResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');
    });
  });
});
