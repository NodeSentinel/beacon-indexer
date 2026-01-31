import { createServer } from 'node:http';

import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHttpServer } from '@/server.js';

describe('Health Endpoint E2E Tests', () => {
  let prisma: PrismaClient;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

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

    // Start the HTTP server
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
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await prisma.$disconnect();
  });

  describe('GET /health/check', () => {
    it('should return healthy status when database is connected', async () => {
      const response = await fetch(`${baseUrl}/health/check`);

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const body = await response.json();

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
      const body = await response.json();

      expect(body.meta).toBeDefined();
      expect(body.meta.timestamp).toBeDefined();
      // Validate timestamp format (ISO 8601)
      expect(() => new Date(body.meta.timestamp)).not.toThrow();
    });
  });
});
