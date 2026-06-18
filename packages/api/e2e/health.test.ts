import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startE2EServer } from './server.js';

interface HealthResponse {
  success: boolean;
  data: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    services: {
      database: {
        status: 'connected' | 'disconnected';
        latencyMs?: number;
      };
    };
  };
  meta: {
    timestamp: string;
  };
}

describe('Health Endpoint E2E Tests', () => {
  let prisma: PrismaClient;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

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

    await prisma.$connect();

    // Start the HTTP server with the real API bootstrap wiring.
    const started = await startE2EServer();
    baseUrl = started.baseUrl;
    closeServer = started.close;
  });

  afterAll(async () => {
    await closeServer();
    await prisma.$disconnect();
  });

  describe('GET /health/check', () => {
    it('should return healthy status when database is connected', async () => {
      const response = await fetch(`${baseUrl}/health/check`);

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const body = (await response.json()) as HealthResponse;

      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.status).toBe('healthy');
      expect(body.data.timestamp).toBeDefined();
      expect(body.data.services).toBeDefined();
      expect(body.data.services.database).toBeDefined();
      expect(body.data.services.database.status).toBe('connected');
      expect(typeof body.data.services.database.latencyMs).toBe('number');
    });

    it('should include meta information in response', async () => {
      const response = await fetch(`${baseUrl}/health/check`);
      const body = (await response.json()) as HealthResponse;

      expect(body.meta).toBeDefined();
      expect(body.meta.timestamp).toBeDefined();
      // Validate timestamp format (ISO 8601)
      expect(() => new Date(body.meta.timestamp)).not.toThrow();
    });
  });
});
