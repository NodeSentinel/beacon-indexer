import { createServer } from 'node:http';

import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { E2E_SESSION_ID, userAuthHeaders } from './helpers.js';

import type {
  AddValidatorsResponse as AddValidatorsData,
  Cluster,
  ClusterDetail,
  ClusterWithCount,
} from '@/routers/cluster/schemas.js';
import { createHttpServer } from '@/server.js';
import type { ApiResponse } from '@/utils/response.js';

// Response types using ApiResponse wrapper with schema types
type ClusterResponse = ApiResponse<Cluster>;
type ClusterWithCountResponse = ApiResponse<ClusterWithCount>;
type ClusterDetailResponse = ApiResponse<ClusterDetail>;
type ClusterListResponse = ApiResponse<ClusterWithCount[]>;
type AddValidatorsResponse = ApiResponse<AddValidatorsData>;
type DeleteResponse = ApiResponse<{ deleted: boolean }>;
type RemoveValidatorsResponse = ApiResponse<{ removed: number }>;

describe('Cluster API E2E Tests', () => {
  let prisma: PrismaClient;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  // Fixed test user ID (string, matching the new User.id type)
  const testOwnerId = 'e2e-test-owner-id';
  // Use a second anonymous session to simulate a different authenticated user.
  const otherSessionId = '99999999-0000-4000-8000-000000000099';
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

    // Ensure a test user exists for the foreign key constraint.
    // Uses the same ID that getOrCreateAnonymous derives from E2E_SESSION_ID.
    await prisma.user.upsert({
      where: { id: testOwnerId },
      update: {},
      create: {
        id: testOwnerId,
        username: `anon:${E2E_SESSION_ID}`,
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
    // Clean up created clusters after each test using deleteMany for efficiency
    if (createdClusterIds.length > 0) {
      await prisma.cluster.deleteMany({ where: { id: { in: createdClusterIds } } });
      createdClusterIds.length = 0;
    }
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

  // Build headers for a second authenticated anonymous user.
  function otherUserAuthHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'ns-anonymous-id': otherSessionId,
      Origin: process.env.ALLOWED_ORIGINS?.split(',')[0]?.trim() || 'http://localhost:3000',
      ...extra,
    };
  }

  describe('POST /clusters', () => {
    it('should create a cluster successfully', async () => {
      // Ensure test validators exist for the create request
      await prisma.validator.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, balance: BigInt(32000000000) },
      });

      const response = await fetch(`${baseUrl}/clusters`, {
        method: 'POST',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: 'Test Cluster',
          visibility: 'private',
          validatorIndexes: [1],
        }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterWithCountResponse;

      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data!.name).toBe('Test Cluster');
      expect(body.data!.visibility).toBe('private');
      expect(body.data!.ownerId).toBe(testOwnerId);
      expect(body.data!.id).toBeDefined();
      expect(body.data!.validatorCount).toBe(1);

      createdClusterIds.push(body.data!.id);
    });

    it('should create a cluster with feeRecipientAddress', async () => {
      // Ensure test validator exists for the create request
      await prisma.validator.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, balance: BigInt(32000000000) },
      });

      const feeRecipient = '0x1234567890123456789012345678901234567890';
      const response = await fetch(`${baseUrl}/clusters`, {
        method: 'POST',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: 'Cluster with Fee',
          visibility: 'shared',
          feeRecipientAddress: feeRecipient,
          validatorIndexes: [1],
        }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterWithCountResponse;

      expect(body.success).toBe(true);
      expect(body.data!.feeRecipientAddress).toBe(feeRecipient);
      expect(body.data!.visibility).toBe('shared');
      expect(body.data!.validatorCount).toBe(1);

      createdClusterIds.push(body.data!.id);
    });

    it('should fail with empty name', async () => {
      const response = await fetch(`${baseUrl}/clusters`, {
        method: 'POST',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: '',
          validatorIndexes: [1],
        }),
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('GET /clusters', () => {
    it('should list clusters for the authenticated user', async () => {
      // Create two clusters first
      const cluster1 = await prisma.cluster.create({
        data: { name: 'List Test 1', ownerId: testOwnerId, visibility: 'private' },
      });
      const cluster2 = await prisma.cluster.create({
        data: { name: 'List Test 2', ownerId: testOwnerId, visibility: 'shared' },
      });
      createdClusterIds.push(cluster1.id, cluster2.id);

      const response = await fetch(`${baseUrl}/clusters`, {
        headers: userAuthHeaders(),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterListResponse;

      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data!.length).toBeGreaterThanOrEqual(2);

      const names = body.data!.map((c) => c.name);
      expect(names).toContain('List Test 1');
      expect(names).toContain('List Test 2');
    });

    it('should return empty array for user with no clusters', async () => {
      // Use a different session ID that has no clusters
      const response = await fetch(`${baseUrl}/clusters`, {
        headers: {
          'ns-anonymous-id': '99999999-0000-4000-8000-000000000099',
          Origin: process.env.ALLOWED_ORIGINS?.split(',')[0]?.trim() || 'http://localhost:3000',
        },
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterListResponse;

      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /clusters/:id', () => {
    it('should get cluster details with validators', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Get Test', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        headers: userAuthHeaders(),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterDetailResponse;

      expect(body.success).toBe(true);
      expect(body.data!.id).toBe(cluster.id);
      expect(body.data!.name).toBe('Get Test');
      expect(body.data!.validators).toBeDefined();
      expect(body.data!.withdrawalAddresses).toBeDefined();
    });

    it('should return error for non-existent cluster', async () => {
      const response = await fetch(`${baseUrl}/clusters/non-existent-id`, {
        headers: userAuthHeaders(),
      });

      expect(response.ok).toBe(true); // API returns 200 with error in body
      const body = (await response.json()) as ClusterResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');
    });
  });

  describe('PUT /clusters/:id', () => {
    it('should update cluster name', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Original Name', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        method: 'PUT',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      expect(body.success).toBe(true);
      expect(body.data!.name).toBe('Updated Name');
    });

    it('should update cluster visibility', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Visibility Test', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        method: 'PUT',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
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
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: 'New Name' }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');
    });

    it('should replace cluster validators in the same update request', async () => {
      // This scenario verifies the save route can swap cluster membership in one request.
      const cluster = await prisma.cluster.create({
        data: { name: 'Replace Validators Test', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      // Seed the existing validator rows used by the cluster before the update.
      await prisma.validator.upsert({
        where: { id: 601 },
        update: {},
        create: { id: 601, balance: BigInt(32000000000) },
      });
      await prisma.validator.upsert({
        where: { id: 602 },
        update: {},
        create: { id: 602, balance: BigInt(32000000000) },
      });
      await prisma.validator.upsert({
        where: { id: 603 },
        update: {},
        create: { id: 603, balance: BigInt(32000000000) },
      });

      // Attach two validators so the update has an existing membership set to replace.
      await prisma.clusterValidator.createMany({
        data: [
          { clusterId: cluster.id, validatorIndex: 601 },
          { clusterId: cluster.id, validatorIndex: 602 },
        ],
      });

      // Save the edited cluster with one kept validator and one newly added validator.
      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        method: 'PUT',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: 'Replace Validators Test Updated',
          validatorIndexes: [602, 603],
        }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      // The cluster metadata update should succeed together with the membership sync.
      expect(body.success).toBe(true);
      expect(body.data!.name).toBe('Replace Validators Test Updated');

      // Read the join table back to confirm the final membership matches the request exactly.
      const validators = await prisma.clusterValidator.findMany({
        where: { clusterId: cluster.id },
        orderBy: { validatorIndex: 'asc' },
      });
      expect(validators.map((row) => row.validatorIndex)).toEqual([602, 603]);
    });

    it('should update validator membership without requiring metadata changes', async () => {
      // This scenario verifies the transactional sync works when the save only changes validators.
      const cluster = await prisma.cluster.create({
        data: { name: 'Validator Only Update Test', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      // Seed the validator rows used by the membership-only update request.
      await prisma.validator.upsert({
        where: { id: 606 },
        update: {},
        create: { id: 606, balance: BigInt(32000000000) },
      });
      await prisma.validator.upsert({
        where: { id: 607 },
        update: {},
        create: { id: 607, balance: BigInt(32000000000) },
      });

      // Start with one validator so the request performs a real membership change.
      await prisma.clusterValidator.create({
        data: { clusterId: cluster.id, validatorIndex: 606 },
      });

      // Save only the new validator set and leave cluster metadata untouched.
      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        method: 'PUT',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          validatorIndexes: [607],
        }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      // The route should keep the original metadata while applying the new membership.
      expect(body.success).toBe(true);
      expect(body.data!.name).toBe('Validator Only Update Test');
      expect(body.data!.visibility).toBe('private');

      // Read the final membership to confirm the validator-only save replaced the join rows.
      const validators = await prisma.clusterValidator.findMany({
        where: { clusterId: cluster.id },
        orderBy: { validatorIndex: 'asc' },
      });
      expect(validators.map((row) => row.validatorIndex)).toEqual([607]);
    });

    it('should allow updating a cluster to an empty validator set', async () => {
      // This scenario proves an edit can intentionally leave the cluster empty.
      const cluster = await prisma.cluster.create({
        data: { name: 'Empty Validators Test', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      // Seed one validator so the update removes a real existing membership.
      await prisma.validator.upsert({
        where: { id: 604 },
        update: {},
        create: { id: 604, balance: BigInt(32000000000) },
      });
      await prisma.clusterValidator.create({
        data: { clusterId: cluster.id, validatorIndex: 604 },
      });

      // Save the cluster with an explicit empty validator list.
      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        method: 'PUT',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          visibility: 'shared',
          validatorIndexes: [],
        }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      // The route should accept the edit and preserve the other metadata changes.
      expect(body.success).toBe(true);
      expect(body.data!.visibility).toBe('shared');

      // The cluster should end with no validator memberships after the sync.
      const validators = await prisma.clusterValidator.findMany({
        where: { clusterId: cluster.id },
      });
      expect(validators).toEqual([]);
    });

    it('should reject validator sync when the edited cluster belongs to another user', async () => {
      // This scenario ensures the ownership guard still protects the transactional save route.
      const cluster = await prisma.cluster.create({
        data: { name: 'Unauthorized Update Test', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      // Seed one existing membership so the unauthorized edit would be destructive if allowed.
      await prisma.validator.upsert({
        where: { id: 605 },
        update: {},
        create: { id: 605, balance: BigInt(32000000000) },
      });
      await prisma.clusterValidator.create({
        data: { clusterId: cluster.id, validatorIndex: 605 },
      });

      // Submit the full edit as a different authenticated user.
      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        method: 'PUT',
        headers: otherUserAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: 'Should Not Apply',
          validatorIndexes: [],
        }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as ClusterResponse;

      // The API must not reveal or mutate clusters owned by another user.
      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');

      // Verify both the name and membership remained unchanged after the rejected request.
      const unchangedCluster = await prisma.cluster.findUniqueOrThrow({
        where: { id: cluster.id },
      });
      expect(unchangedCluster.name).toBe('Unauthorized Update Test');
      const validators = await prisma.clusterValidator.findMany({
        where: { clusterId: cluster.id },
      });
      expect(validators.map((row) => row.validatorIndex)).toEqual([605]);
    });
  });

  describe('DELETE /clusters/:id', () => {
    it('should delete cluster successfully', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Delete Test', ownerId: testOwnerId, visibility: 'private' },
      });
      // Don't add to createdClusterIds since we're deleting it

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}`, {
        method: 'DELETE',
        headers: userAuthHeaders(),
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
        headers: userAuthHeaders(),
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
        data: { name: 'Add Validators Test', ownerId: testOwnerId, visibility: 'private' },
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
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ validatorIndexes: [1, 2] }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.added).toBe(2);
    });

    it('should handle duplicate validators (skipDuplicates)', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Duplicate Test', ownerId: testOwnerId, visibility: 'private' },
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
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ validatorIndexes: [3] }),
      });

      // Add same validator again
      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
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
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ validatorIndexes: [1] }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');
    });
  });

  describe('DELETE /clusters/:id/validators - by validatorIndexes', () => {
    it('should remove validators from cluster', async () => {
      const cluster = await prisma.cluster.create({
        data: {
          name: 'Remove Validators Test',
          ownerId: testOwnerId,
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      // Ensure test validators exist and add to cluster
      await prisma.validator.upsert({
        where: { id: 4 },
        update: {},
        create: { id: 4, balance: BigInt(32000000000) },
      });
      await prisma.validator.upsert({
        where: { id: 5 },
        update: {},
        create: { id: 5, balance: BigInt(32000000000) },
      });
      await prisma.clusterValidator.createMany({
        data: [
          { clusterId: cluster.id, validatorIndex: 4 },
          { clusterId: cluster.id, validatorIndex: 5 },
        ],
      });

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'DELETE',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ validatorIndexes: [4, 5] }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.removed).toBe(2);

      // Verify validators were removed
      const remaining = await prisma.clusterValidator.findMany({
        where: { clusterId: cluster.id },
      });
      expect(remaining.length).toBe(0);
    });

    it('should return 0 when validators are not in cluster', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'Not In Cluster Test', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'DELETE',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ validatorIndexes: [999] }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.removed).toBe(0);
    });

    it('should return error for non-existent cluster', async () => {
      const response = await fetch(`${baseUrl}/clusters/non-existent-id/validators`, {
        method: 'DELETE',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ validatorIndexes: [1] }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');
    });

    it('should not allow a different authenticated user to remove validators from another owner cluster', async () => {
      // Create an owner cluster with two validators so the unauthorized request has something to remove.
      const cluster = await prisma.cluster.create({
        data: { name: 'Unauthorized Remove Test', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      // Create validators and attach them to the owner cluster.
      await prisma.validator.upsert({
        where: { id: 401 },
        update: {},
        create: { id: 401, balance: BigInt(32000000000) },
      });
      await prisma.validator.upsert({
        where: { id: 402 },
        update: {},
        create: { id: 402, balance: BigInt(32000000000) },
      });
      await prisma.clusterValidator.createMany({
        data: [
          { clusterId: cluster.id, validatorIndex: 401 },
          { clusterId: cluster.id, validatorIndex: 402 },
        ],
      });

      // Send the delete request as a different authenticated anonymous user.
      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'DELETE',
        headers: otherUserAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ validatorIndexes: [401, 402] }),
      });

      // The API must reject access to clusters owned by a different user.
      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('CLUSTER_NOT_FOUND');

      // Confirm the owner cluster still has both validators after the rejected request.
      const remaining = await prisma.clusterValidator.findMany({
        where: { clusterId: cluster.id },
        orderBy: { validatorIndex: 'asc' },
      });
      expect(remaining.map((row) => row.validatorIndex)).toEqual([401, 402]);
    });
  });

  describe('POST /clusters/:id/validators - validator validation', () => {
    it('should return error when validator index does not exist', async () => {
      const cluster = await prisma.cluster.create({
        data: {
          name: 'Validator Not Exists Test',
          ownerId: testOwnerId,
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
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
          ownerId: testOwnerId,
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
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
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
        data: { name: 'Add By Address Test', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
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
          ownerId: testOwnerId,
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      // Use uppercase address
      const upperCaseAddress = testWithdrawalAddress.toUpperCase();

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
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
          ownerId: testOwnerId,
          visibility: 'private',
        },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'POST',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ withdrawalAddress: '0x0000000000000000000000000000000000000000' }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as AddValidatorsResponse;

      expect(body.success).toBe(false);
      expect(body.error!.code).toBe('VALIDATORS_NOT_FOUND');
    });
  });

  describe('DELETE /clusters/:id/validators - by withdrawalAddress', () => {
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
          name: 'Remove By Withdrawal Address Test',
          ownerId: testOwnerId,
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

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'DELETE',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ withdrawalAddress: testWithdrawalAddress }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsResponse;

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
          ownerId: testOwnerId,
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

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'DELETE',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ withdrawalAddress: mixedCaseAddress }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.removed).toBe(2);
    });

    it('should return 0 removed when no validators match', async () => {
      const cluster = await prisma.cluster.create({
        data: { name: 'No Match Remove Test', ownerId: testOwnerId, visibility: 'private' },
      });
      createdClusterIds.push(cluster.id);

      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/validators`, {
        method: 'DELETE',
        headers: userAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ withdrawalAddress: '0x0000000000000000000000000000000000000000' }),
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as RemoveValidatorsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.removed).toBe(0);
    });
  });
});
