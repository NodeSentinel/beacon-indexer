import { PrismaClient } from '@beacon-indexer/db';

import type { Logger } from '@/lib/logger.js';

/**
 * Builds the Prisma client with API-specific connection settings.
 */
export function createPrisma(databaseUrl: string, logger: Logger): PrismaClient {
  const prismaUrl = databaseUrl.includes('?')
    ? `${databaseUrl}&pool_timeout=30&connect_timeout=10`
    : `${databaseUrl}?pool_timeout=30&connect_timeout=10`;

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: prismaUrl,
      },
    },
    log: [
      {
        emit: 'event',
        level: 'error',
      },
      {
        emit: 'event',
        level: 'warn',
      },
    ],
  });

  // Hooks Prisma events into the API logger so callers only configure logging once.
  prisma.$on('error' as never, (event: { message: string; target?: string }) => {
    logger.error({ err: event }, 'Prisma error');
  });

  prisma.$on('warn' as never, (event: { message: string; target?: string }) => {
    logger.warn({ warn: event }, 'Prisma warning');
  });

  return prisma;
}

/**
 * Disconnects Prisma and logs the shutdown result.
 */
export async function disconnectPrisma(prisma: PrismaClient, logger: Logger) {
  await prisma.$disconnect();
  logger.info('Prisma disconnected');
}
