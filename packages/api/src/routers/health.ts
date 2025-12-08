import { z } from 'zod';

import { publicProcedure } from '@/lib/orpc.js';
import { getPrisma } from '@/lib/prisma.js';
import { ApiResponseSchema } from '@/utils/response.js';

const HealthResponseSchema = ApiResponseSchema(
  z.object({
    status: z.enum(['healthy', 'degraded', 'unhealthy']),
    timestamp: z.string(),
    services: z.object({
      database: z.object({
        status: z.enum(['connected', 'disconnected']),
        latencyMs: z.number().optional(),
      }),
    }),
  }),
);

/**
 * Health check endpoint
 * Public endpoint - no authentication required
 */
export const healthCheck = publicProcedure.output(HealthResponseSchema).handler(async () => {
  const prisma = getPrisma();
  const startTime = Date.now();

  let dbStatus: 'connected' | 'disconnected' = 'disconnected';
  let dbLatency: number | undefined;

  try {
    // Simple database health check
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
    dbLatency = Date.now() - startTime;
  } catch (error) {
    console.error(`Database health check failed: ${error}`);
    dbStatus = 'disconnected';
  }

  const overallStatus = dbStatus === 'connected' ? 'healthy' : 'unhealthy';

  return {
    success: true,
    data: {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        database: {
          status: dbStatus,
          latencyMs: dbLatency,
        },
      },
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };
});

export const healthRouter = {
  check: healthCheck,
};
