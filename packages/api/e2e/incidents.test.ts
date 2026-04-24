import { createServer } from 'node:http';

import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { botAuthHeaders, E2E_SESSION_ID, userAuthHeaders } from './helpers.js';

import { createHttpServer } from '@/server.js';
import type { ApiResponse } from '@/utils/response.js';

type IncidentListItem = {
  id: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedSlot: number;
  closedAt: string | null;
  closedSlot: number | null;
  durationSlots: number | null;
  durationSeconds: number | null;
  missedAttestationRewards: string | null;
  missedSyncRewards: string | null;
  missedConsensusRewards: string | null;
  rewardsFinalized: boolean;
  rewardsFinalizedAt: string | null;
  openedNotificationQueuedAt: string | null;
  closedNotificationQueuedAt: string | null;
};

type IncidentListPayload = {
  incidents: IncidentListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
};

type IncidentAffectedValidator = {
  validatorIndex: number;
  inactiveFromSlot: number;
  inactiveToSlot: number | null;
  rewardsProcessedThroughSlot: number | null;
  missedAttestationRewards: string;
  missedSyncRewards: string;
  missedConsensusRewards: string;
};

type IncidentAffectedValidatorsPayload = {
  validators: IncidentAffectedValidator[];
  totalCount: number;
  page: number;
  pageSize: number;
};

type IncidentNotificationPayload = {
  incidentId: string;
  notifiedAt: string;
};

describe('Incident API E2E Tests', () => {
  let prisma: PrismaClient;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  // This user matches the anonymous auth helper used in API tests.
  const anonymousOwnerId = 'e2e-test-owner-id';
  // This user exercises bot-signature auth through bot-user-id resolution.
  const botOwnerId = 'e2e-bot-owner-id';
  const botTelegramId = '123456789';
  // This second bot user proves ownership checks reject foreign clusters.
  const foreignBotOwnerId = 'e2e-bot-owner-id-2';
  const foreignBotTelegramId = '987654321';

  beforeAll(async () => {
    // This suite requires the configured test database.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    // This Prisma client points at the same database used by the API server.
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    // This connection lets the suite seed and verify database state directly.
    await prisma.$connect();

    // This user supports the existing anonymous-session auth flow.
    await prisma.user.upsert({
      where: { id: anonymousOwnerId },
      update: {},
      create: {
        id: anonymousOwnerId,
        username: `anon:${E2E_SESSION_ID}`,
      },
    });

    // This user supports bot-signature requests for owned resources.
    await prisma.user.upsert({
      where: { id: botOwnerId },
      update: {
        telegramId: BigInt(botTelegramId),
        username: 'incident-bot-owner',
      },
      create: {
        id: botOwnerId,
        telegramId: BigInt(botTelegramId),
        username: 'incident-bot-owner',
      },
    });

    // This user supports foreign bot-signature requests for auth rejection checks.
    await prisma.user.upsert({
      where: { id: foreignBotOwnerId },
      update: {
        telegramId: BigInt(foreignBotTelegramId),
        username: 'incident-bot-foreign-owner',
      },
      create: {
        id: foreignBotOwnerId,
        telegramId: BigInt(foreignBotTelegramId),
        username: 'incident-bot-foreign-owner',
      },
    });

    // This server instance exposes the same REST handlers used in production.
    server = createHttpServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();

        // This local URL is used by every request in the suite.
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }

        resolve();
      });
    });
  });

  afterEach(async () => {
    // This cleanup resets incident rows between scenarios.
    await prisma.clusterIncidentValidator.deleteMany({});
    await prisma.clusterIncident.deleteMany({});
    await prisma.clusterValidator.deleteMany({});
    await prisma.cluster.deleteMany({
      where: {
        ownerId: {
          in: [anonymousOwnerId, botOwnerId, foreignBotOwnerId],
        },
      },
    });
    await prisma.validator.deleteMany({
      where: {
        id: {
          in: [101, 102, 103, 104, 105],
        },
      },
    });
  });

  afterAll(async () => {
    // This closes the HTTP server before disconnecting the test database.
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // This disconnect prevents hanging Vitest workers.
    await prisma.$disconnect();
  });

  /**
   * This helper creates a validator row used by incident interval records.
   */
  async function seedValidator(validatorIndex: number) {
    await prisma.validator.upsert({
      where: { id: validatorIndex },
      update: {},
      create: {
        id: validatorIndex,
        balance: BigInt(32_000_000_000),
      },
    });
  }

  describe('GET /clusters/:id/incidents', () => {
    it('returns paginated incidents ordered by newest first', async () => {
      // This cluster owns the incident history returned by the endpoint.
      const cluster = await prisma.cluster.create({
        data: {
          id: 'cluster-incidents-list',
          name: 'Incident History',
          ownerId: anonymousOwnerId,
          visibility: 'private',
        },
      });

      // This older incident exercises second-page pagination.
      await prisma.clusterIncident.create({
        data: {
          id: '00000000-0000-4000-8000-000000000111',
          clusterId: cluster.id,
          status: 'closed',
          openedAt: new Date('2025-01-01T00:00:00.000Z'),
          openedSlot: 100,
          closedAt: new Date('2025-01-01T01:00:00.000Z'),
          closedSlot: 200,
          durationSlots: 100,
          durationSeconds: 3600,
          missedAttestationRewards: BigInt(10),
          missedSyncRewards: BigInt(5),
          missedConsensusRewards: BigInt(15),
          rewardsFinalized: true,
          rewardsFinalizedAt: new Date('2025-01-01T01:05:00.000Z'),
        },
      });

      // This newer incident exercises first-page ordering.
      await prisma.clusterIncident.create({
        data: {
          id: '00000000-0000-4000-8000-000000000222',
          clusterId: cluster.id,
          status: 'open',
          openedAt: new Date('2025-01-02T00:00:00.000Z'),
          openedSlot: 300,
          missedAttestationRewards: BigInt(20),
          missedSyncRewards: BigInt(7),
          missedConsensusRewards: BigInt(27),
        },
      });

      // This request reads only one incident to force pagination metadata.
      const response = await fetch(
        `${baseUrl}/clusters/${cluster.id}/incidents?page=1&pageSize=1`,
        {
          headers: userAuthHeaders(),
        },
      );

      // This assertion confirms the route exists and returns a wrapped payload.
      expect(response.ok).toBe(true);
      const body = (await response.json()) as ApiResponse<IncidentListPayload>;

      // This verifies the page shape and first-page ordering.
      expect(body.success).toBe(true);
      expect(body.data?.totalCount).toBe(2);
      expect(body.data?.page).toBe(1);
      expect(body.data?.pageSize).toBe(1);
      expect(body.data?.incidents).toHaveLength(1);
      expect(body.data?.incidents[0]?.id).toBe('00000000-0000-4000-8000-000000000222');
      expect(body.data?.incidents[0]?.missedConsensusRewards).toBe('0.00000000084375');
    });
  });

  describe('POST /clusters/:id/incidents/opened-notified', () => {
    it('updates the open incident notification timestamp for bot-authenticated calls', async () => {
      // This cluster belongs to the user resolved from bot-user-id.
      const cluster = await prisma.cluster.create({
        data: {
          id: 'cluster-open-notified',
          name: 'Open Incident',
          ownerId: botOwnerId,
          visibility: 'private',
        },
      });

      // This open incident should receive the latest notification timestamp.
      const incident = await prisma.clusterIncident.create({
        data: {
          id: '00000000-0000-4000-8000-000000000333',
          clusterId: cluster.id,
          status: 'open',
          openedAt: new Date('2025-01-03T00:00:00.000Z'),
          openedSlot: 400,
          openedNotificationQueuedAt: new Date('2025-01-03T01:00:00.000Z'),
        },
      });

      // This request simulates the telegram bot resending an open notification.
      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/incidents/opened-notified`, {
        method: 'POST',
        headers: botAuthHeaders(botTelegramId, {
          'Content-Type': 'application/json',
        }),
      });

      // This assertion confirms the endpoint accepts bot-signature auth.
      expect(response.ok).toBe(true);
      const body = (await response.json()) as ApiResponse<IncidentNotificationPayload>;

      // This verifies the response exposes the updated incident id and timestamp.
      expect(body.success).toBe(true);
      expect(body.data?.incidentId).toBe(incident.id);
      expect(body.data?.notifiedAt).toBeTruthy();

      // This query confirms the timestamp was overwritten in the database.
      const reloaded = await prisma.clusterIncident.findUniqueOrThrow({
        where: { id: incident.id },
      });
      expect(reloaded.openedNotificationQueuedAt?.toISOString()).toBe(body.data?.notifiedAt);
      expect(reloaded.openedNotificationQueuedAt?.getTime()).toBeGreaterThan(
        incident.openedNotificationQueuedAt!.getTime(),
      );
    });

    it('rejects a cluster owned by another user', async () => {
      // This cluster belongs to a different bot-authenticated user.
      const cluster = await prisma.cluster.create({
        data: {
          id: 'cluster-open-notified-foreign',
          name: 'Foreign Open Incident',
          ownerId: botOwnerId,
          visibility: 'private',
        },
      });

      // This incident exists but should stay inaccessible to the foreign bot user.
      await prisma.clusterIncident.create({
        data: {
          id: '00000000-0000-4000-8000-000000000334',
          clusterId: cluster.id,
          status: 'open',
          openedAt: new Date('2025-01-03T00:00:00.000Z'),
          openedSlot: 401,
        },
      });

      // This request uses a different bot-user-id than the cluster owner.
      const response = await fetch(`${baseUrl}/clusters/${cluster.id}/incidents/opened-notified`, {
        method: 'POST',
        headers: botAuthHeaders(foreignBotTelegramId, {
          'Content-Type': 'application/json',
        }),
      });

      // This assertion confirms unauthorized bot access is rejected.
      expect(response.ok).toBe(true);
      const body = (await response.json()) as ApiResponse<IncidentNotificationPayload>;
      expect(body.success).toBe(false);
    });
  });

  describe('POST /clusters/incidents/:incidentId/closed-notified', () => {
    it('updates the closed incident notification timestamp for bot-authenticated calls', async () => {
      // This cluster belongs to the bot-resolved owner.
      const cluster = await prisma.cluster.create({
        data: {
          id: 'cluster-closed-notified',
          name: 'Closed Incident',
          ownerId: botOwnerId,
          visibility: 'private',
        },
      });

      // This closed incident should receive the latest close notification timestamp.
      const incident = await prisma.clusterIncident.create({
        data: {
          id: '00000000-0000-4000-8000-000000000444',
          clusterId: cluster.id,
          status: 'closed',
          openedAt: new Date('2025-01-04T00:00:00.000Z'),
          openedSlot: 500,
          closedAt: new Date('2025-01-04T02:00:00.000Z'),
          closedSlot: 520,
        },
      });

      // This request records the latest bot send time for the closed incident.
      const response = await fetch(`${baseUrl}/clusters/incidents/${incident.id}/closed-notified`, {
        method: 'POST',
        headers: botAuthHeaders(botTelegramId, {
          'Content-Type': 'application/json',
        }),
      });

      // This assertion confirms the endpoint updates the target incident.
      expect(response.ok).toBe(true);
      const body = (await response.json()) as ApiResponse<IncidentNotificationPayload>;
      expect(body.success).toBe(true);
      expect(body.data?.incidentId).toBe(incident.id);

      // This query confirms the closed-notified timestamp persisted.
      const reloaded = await prisma.clusterIncident.findUniqueOrThrow({
        where: { id: incident.id },
      });
      expect(reloaded.closedNotificationQueuedAt?.toISOString()).toBe(body.data?.notifiedAt);
    });
  });

  describe('GET /clusters/incidents/:incidentId/affected-validators', () => {
    it('returns paginated affected validators ordered by validator index', async () => {
      // This cluster owns the incident validator rows returned by the endpoint.
      const cluster = await prisma.cluster.create({
        data: {
          id: 'cluster-affected-validators',
          name: 'Affected Validators',
          ownerId: botOwnerId,
          visibility: 'private',
        },
      });

      // These validator rows back the incident interval records.
      await seedValidator(101);
      await seedValidator(102);
      await seedValidator(103);

      // This incident groups the validator intervals returned by the endpoint.
      const incident = await prisma.clusterIncident.create({
        data: {
          id: '00000000-0000-4000-8000-000000000555',
          clusterId: cluster.id,
          status: 'closed',
          openedAt: new Date('2025-01-05T00:00:00.000Z'),
          openedSlot: 600,
          closedAt: new Date('2025-01-05T03:00:00.000Z'),
          closedSlot: 630,
        },
      });

      // This first row should land on page one.
      await prisma.clusterIncidentValidator.create({
        data: {
          id: '00000000-0000-4000-8000-000000000561',
          incidentId: incident.id,
          validatorIndex: 101,
          inactiveFromSlot: 600,
          inactiveToSlot: 610,
          rewardsProcessedThroughSlot: 610,
          missedAttestationRewards: BigInt(10),
          missedSyncRewards: BigInt(0),
          missedConsensusRewards: BigInt(10),
        },
      });

      // This second row should land on page one after sorting.
      await prisma.clusterIncidentValidator.create({
        data: {
          id: '00000000-0000-4000-8000-000000000562',
          incidentId: incident.id,
          validatorIndex: 102,
          inactiveFromSlot: 601,
          inactiveToSlot: 611,
          rewardsProcessedThroughSlot: 611,
          missedAttestationRewards: BigInt(11),
          missedSyncRewards: BigInt(1),
          missedConsensusRewards: BigInt(12),
        },
      });

      // This third row should move to page two.
      await prisma.clusterIncidentValidator.create({
        data: {
          id: '00000000-0000-4000-8000-000000000563',
          incidentId: incident.id,
          validatorIndex: 103,
          inactiveFromSlot: 602,
          inactiveToSlot: 612,
          rewardsProcessedThroughSlot: 612,
          missedAttestationRewards: BigInt(12),
          missedSyncRewards: BigInt(2),
          missedConsensusRewards: BigInt(14),
        },
      });

      // This request reads only two validators to force pagination.
      const response = await fetch(
        `${baseUrl}/clusters/incidents/${incident.id}/affected-validators?page=1&pageSize=2`,
        {
          headers: botAuthHeaders(botTelegramId),
        },
      );

      // This assertion confirms the route returns a paginated validator list.
      expect(response.ok).toBe(true);
      const body = (await response.json()) as ApiResponse<IncidentAffectedValidatorsPayload>;

      // This verifies pagination metadata and index ordering.
      expect(body.success).toBe(true);
      expect(body.data?.totalCount).toBe(3);
      expect(body.data?.page).toBe(1);
      expect(body.data?.pageSize).toBe(2);
      expect(body.data?.validators.map((row) => row.validatorIndex)).toEqual([101, 102]);
      expect(body.data?.validators[0]?.missedConsensusRewards).toBe('0.0000000003125');
    });
  });
});
