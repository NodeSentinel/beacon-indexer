import { PrismaClient } from '@beacon-indexer/db';

import { logger } from './logger.js';

import { env } from '@/config/env.js';

// Singleton pattern for Prisma client
let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    const databaseUrl = env.DATABASE_URL.includes('?')
      ? `${env.DATABASE_URL}&pool_timeout=30&connect_timeout=10`
      : `${env.DATABASE_URL}?pool_timeout=30&connect_timeout=10`;

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
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

    // Log Prisma errors
    prisma.$on('error' as never, (e: { message: string; target?: string }) => {
      logger.error({ err: e }, 'Prisma error');
    });

    prisma.$on('warn' as never, (e: { message: string; target?: string }) => {
      logger.warn({ warn: e }, 'Prisma warning');
    });
  }

  return prisma;
}

export async function disconnectPrisma() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    logger.info('Prisma disconnected');
  }
}
