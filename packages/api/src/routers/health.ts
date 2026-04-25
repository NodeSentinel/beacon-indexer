/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

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
 * Creates the health router.
 */
export function createHealthRouter(params: {
  prisma: { $queryRaw: typeof import('@beacon-indexer/db').PrismaClient.prototype.$queryRaw };
  procedures: { publicProcedure: any };
}) {
  const { publicProcedure } = params.procedures;

  const healthCheck = publicProcedure
    .route({ method: 'GET', path: '/health/check' })
    .output(HealthResponseSchema)
    .handler(async () => {
      const startTime = Date.now();
      let dbStatus: 'connected' | 'disconnected' = 'disconnected';
      let dbLatency: number | undefined;

      try {
        await params.prisma.$queryRaw`SELECT 1`;
        dbStatus = 'connected';
        dbLatency = Date.now() - startTime;
      } catch (error) {
        console.error(`Database health check failed: ${error}`);
      }

      return {
        success: true,
        data: {
          status: dbStatus === 'connected' ? 'healthy' : 'unhealthy',
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

  return {
    check: healthCheck,
  };
}
