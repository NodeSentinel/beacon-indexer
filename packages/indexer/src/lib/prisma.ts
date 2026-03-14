import { PrismaClient } from '@beacon-indexer/db';

import { env } from '@/src/lib/env.js';

let prisma: PrismaClient | undefined = undefined;

export const getPrisma = () => {
  if (prisma) return prisma;
  prisma = new PrismaClient({
    datasourceUrl: `${env.DATABASE_URL}&pool_timeout=0`,
    transactionOptions: {
      maxWait: 180000,
      timeout: 180000,
    },
    log: [
      {
        emit: 'event',
        level: 'query',
      },
    ],
  });
  return prisma;
};

process.on('beforeExit', async () => {
  await prisma?.$disconnect();
});
