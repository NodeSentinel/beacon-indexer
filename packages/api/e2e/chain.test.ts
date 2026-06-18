import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders } from './helpers.js';
import { FIXED_TOKEN_PRICE, startE2EServer } from './server.js';

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

interface TokenPriceResponse {
  success: boolean;
  data?: {
    tokenPrice: number;
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
  let baseUrl: string;
  let closeServer: () => Promise<void>;

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

    const started = await startE2EServer();
    baseUrl = started.baseUrl;
    closeServer = started.close;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.$executeRaw`DELETE FROM chain_epoch_stats WHERE epoch >= 900000`;

    await closeServer();
    await prisma.$disconnect();
  });

  describe('GET /chain/stats', () => {
    it('should return 200 with error payload when no stats exist', async () => {
      await prisma.$executeRaw`DELETE FROM chain_epoch_stats`;

      const response = await fetch(`${baseUrl}/chain/stats`, { headers: authHeaders() });
      const body = (await response.json()) as ChainStatsResponse;

      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      expect(body.error!.code).toBe('NOT_FOUND');
    });

    // Verifies that chain stats return validator totals without token price data.
    it('should return stats when data exists', async () => {
      // Reset test stats rows so the assertion reads only this scenario data.
      await prisma.$executeRaw`DELETE FROM chain_epoch_stats WHERE epoch >= 900000`;

      // Insert one synthetic latest stats row for the route to return.
      await prisma.$executeRaw`
        INSERT INTO chain_epoch_stats (epoch, total_active_validators, total_staked, validators_entering, validators_exiting, validators_consolidating)
        VALUES (999999, 450000, 14400000000000000, 2300, 500, 50)
        ON CONFLICT (epoch) DO NOTHING
      `;

      const response = await fetch(`${baseUrl}/chain/stats`, { headers: authHeaders() });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const body = (await response.json()) as ChainStatsResponse;

      // Confirm the stats payload contains only chain statistics.
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data!.epoch).toBe(999999);
      expect(body.data!.totalActiveValidators).toBe(450000);
      expect(typeof body.data!.totalStaked).toBe('string');
      expect(body.data!.validatorsEntering).toBe(2300);
      expect(body.data!.validatorsExiting).toBe(500);
      expect(body.data!.validatorsConsolidating).toBe(50);
      expect(body.data).not.toHaveProperty('tokenPrice');
    });

    it('should return the latest epoch stats', async () => {
      await prisma.$executeRaw`DELETE FROM chain_epoch_stats WHERE epoch >= 900000`;
      await prisma.$executeRaw`
        INSERT INTO chain_epoch_stats (epoch, total_active_validators, total_staked, validators_entering, validators_exiting, validators_consolidating)
        VALUES
          (999998, 440000, 14080000000000000, 2100, 450, 40),
          (999999, 450000, 14400000000000000, 2300, 500, 50)
        ON CONFLICT (epoch) DO NOTHING
      `;

      const response = await fetch(`${baseUrl}/chain/stats`, { headers: authHeaders() });
      const body = (await response.json()) as ChainStatsResponse;

      expect(body.success).toBe(true);
      expect(body.data!.epoch).toBe(999999);
    });

    it('should include meta information', async () => {
      await prisma.$executeRaw`DELETE FROM chain_epoch_stats WHERE epoch >= 900000`;
      await prisma.$executeRaw`
        INSERT INTO chain_epoch_stats (epoch, total_active_validators, total_staked, validators_entering, validators_exiting, validators_consolidating)
        VALUES (999999, 450000, 14400000000000000, 2300, 500, 50)
        ON CONFLICT (epoch) DO NOTHING
      `;

      const response = await fetch(`${baseUrl}/chain/stats`, { headers: authHeaders() });
      const body = (await response.json()) as ChainStatsResponse;

      expect(body.meta).toBeDefined();
      expect(body.meta.timestamp).toBeDefined();
      expect(() => new Date(body.meta.timestamp)).not.toThrow();
    });
  });

  describe('GET /chain/token-price', () => {
    // Verifies that token price has its own endpoint separate from chain stats.
    it('should return the current token price', async () => {
      // Request the dedicated price route with normal auth headers.
      const response = await fetch(`${baseUrl}/chain/token-price`, { headers: authHeaders() });
      const body = (await response.json()) as TokenPriceResponse;

      // Confirm the route returns the stubbed token price used by the e2e server.
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data!.tokenPrice).toBe(FIXED_TOKEN_PRICE);
    });
  });
});
