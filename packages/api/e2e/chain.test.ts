import { createServer } from 'node:http';

import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHttpServer } from '@/server.js';

interface ChainStatsResponse {
  success: boolean;
  data?: {
    epoch: number;
    totalActiveValidators: number;
    totalStaked: string;
    validatorsEntering: number;
    validatorsExiting: number;
    validatorsConsolidating: number;
  };
  error?: {
    code: string;
    message: string;
  };
  meta: {
    timestamp: string;
  };
}

describe('Chain Stats Endpoint E2E Tests', () => {
  let prisma: PrismaClient;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

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

  afterAll(async () => {
    // Clean up test data
    await prisma.$executeRaw`DELETE FROM chain_epoch_stats WHERE epoch >= 900000`;

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await prisma.$disconnect();
  });

  describe('GET /chain/stats', () => {
    it('should return 200 with error payload when no stats exist', async () => {
      // Ensure no stats exist for our test range
      await prisma.$executeRaw`DELETE FROM chain_epoch_stats WHERE epoch >= 900000`;

      const response = await fetch(`${baseUrl}/chain/stats`);
      const body = (await response.json()) as ChainStatsResponse;

      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      expect(body.error!.code).toBe('NOT_FOUND');
    });

    it('should return stats when data exists', async () => {
      // Insert test data
      await prisma.$executeRaw`
        INSERT INTO chain_epoch_stats (epoch, total_active_validators, total_staked, validators_entering, validators_exiting, validators_consolidating)
        VALUES (999999, 450000, 14400000000000000, 2300, 500, 50)
        ON CONFLICT (epoch) DO NOTHING
      `;

      const response = await fetch(`${baseUrl}/chain/stats`);

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const body = (await response.json()) as ChainStatsResponse;

      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data!.epoch).toBe(999999);
      expect(body.data!.totalActiveValidators).toBe(450000);
      expect(typeof body.data!.totalStaked).toBe('string');
      expect(body.data!.validatorsEntering).toBe(2300);
      expect(body.data!.validatorsExiting).toBe(500);
      expect(body.data!.validatorsConsolidating).toBe(50);
    });

    it('should return the latest epoch stats', async () => {
      // Insert two epochs
      await prisma.$executeRaw`
        INSERT INTO chain_epoch_stats (epoch, total_active_validators, total_staked, validators_entering, validators_exiting, validators_consolidating)
        VALUES (999998, 440000, 14080000000000000, 2100, 450, 40)
        ON CONFLICT (epoch) DO NOTHING
      `;

      const response = await fetch(`${baseUrl}/chain/stats`);
      const body = (await response.json()) as ChainStatsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.epoch).toBe(999999);
    });

    it('should include meta information', async () => {
      const response = await fetch(`${baseUrl}/chain/stats`);
      const body = (await response.json()) as ChainStatsResponse;

      expect(body.meta).toBeDefined();
      expect(body.meta.timestamp).toBeDefined();
      expect(() => new Date(body.meta.timestamp)).not.toThrow();
    });
  });
});
