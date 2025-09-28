import { PrismaClient } from '@beacon-indexer/db';

async function cleanDatabase() {
  // Check if we're running on localhost
  const { POSTGRES_HOST = 'localhost' } = process.env;
  const isLocalhost = POSTGRES_HOST === 'localhost';

  if (!isLocalhost) {
    console.error('❌ This script can only be run on localhost database!');
    process.exit(1);
  }

  console.log('🧹 Starting database cleanup...');

  const prisma = new PrismaClient();

  try {
    // Execute the cleanup in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`truncate "Epoch"`;
      await tx.$executeRaw`truncate "Slot" cascade`;
      await tx.$executeRaw`truncate "Committee" cascade`;
      await tx.$executeRaw`truncate "Validator" cascade`;
      await tx.$executeRaw`truncate "SyncCommittee" cascade`;

      await tx.$executeRaw`truncate "ExecutionRewards"`;

      await tx.$executeRaw`truncate "HourlyValidatorStats"`;
      await tx.$executeRaw`truncate "HourlyBlockAndSyncRewards"`;

      await tx.$executeRaw`truncate "DailyValidatorStats"`;

      await tx.$executeRaw`truncate "LastSummaryUpdate"`;

      await tx.$executeRaw`truncate "User" cascade`;
      await tx.$executeRaw`truncate "WithdrawalAddress" cascade`;
      await tx.$executeRaw`truncate "FeeRewardAddress" cascade`;
    });

    console.log('✅ Database cleaned successfully!');
  } catch (error) {
    console.error('❌ Error cleaning database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanDatabase();
