import { PrismaClient } from '@beacon-indexer/db';

import { env } from '@/src/lib/env.js';
import createLogger from '@/src/lib/pino.js';

const logger = createLogger('Prisma');

let prisma: PrismaClient | undefined = undefined;

export const getPrisma = () => {
  if (prisma) return prisma;
  prisma = new PrismaClient({
    datasourceUrl: env.DATABASE_URL,
    transactionOptions: {
      maxWait: 60_000,
      timeout: 60_000,
    },
    log: [
      {
        emit: 'event',
        level: 'error',
      },
    ],
  });

  prisma.$on('error' as never, (e: { message: string; target?: string }) => {
    logger.error('Prisma error:', e);
  });

  return prisma;
};
