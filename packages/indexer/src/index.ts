import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { PrismaClient } from '@beacon-indexer/db';
import ms from 'ms';

import { env, chainConfig } from '@/src/lib/env.js';
import createLogger from '@/src/lib/pino.js';
import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { HourlyArchiveController } from '@/src/services/consensus/controllers/hourlyArchive.js';
import { IndexerConfigController } from '@/src/services/consensus/controllers/indexerConfig.js';
import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { HourlyArchiveStorage } from '@/src/services/consensus/storage/hourlyArchive.js';
import { IndexerConfigStorage } from '@/src/services/consensus/storage/indexerConfig.js';
import { PartitionStorage } from '@/src/services/consensus/storage/partition.js';
import { SlotStorage } from '@/src/services/consensus/storage/slot.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { ExecutionClient } from '@/src/services/execution/execution.js';
import initXstateMachines from '@/src/xstate/index.js';
import { getMultiMachineLogger } from '@/src/xstate/multiMachineLogger.js';

const logger = createLogger('index file');

// Build database URL with proper query parameter handling
const databaseUrl = env.DATABASE_URL.includes('?')
  ? `${env.DATABASE_URL}&pool_timeout=0&connect_timeout=10`
  : `${env.DATABASE_URL}?pool_timeout=0&connect_timeout=10`;

const prisma = new PrismaClient({
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
  ],
});

// Log Prisma errors for debugging
prisma.$on('error' as never, (e: { message: string; target?: string }) => {
  logger.error('Prisma error:', e);
});

// Cleanup function to ensure Prisma disconnects properly
async function cleanup() {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected successfully');
  } catch (error) {
    logger.error('Error disconnecting from database:', error);
  }
  getMultiMachineLogger().done();
}

// Handle graceful shutdown signals
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  await cleanup();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', async (error) => {
  logger.error('Uncaught exception:', error);
  await cleanup();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  logger.error('Unhandled rejection at:', { promise, reason });
  await cleanup();
  process.exit(1);
});

async function main() {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully');
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    // Try to disconnect if connection partially succeeded
    try {
      await prisma.$disconnect();
    } catch {
      // Ignore disconnect errors if connection failed
    }
    throw error;
  }

  // Validate or initialize indexer configuration
  // This must happen before any other initialization to prevent data corruption
  const indexerConfigStorage = new IndexerConfigStorage(prisma);
  const indexerConfigController = new IndexerConfigController(indexerConfigStorage);
  await indexerConfigController.validateOrInitializeConfig(env.CHAIN, env.CONSENSUS_LOOKBACK_SLOT);
  logger.info('Indexer configuration validated successfully');

  // Initialize dependencies
  const beaconClient = new BeaconClient({
    fullNodeUrl: env.CONSENSUS_FULL_API_URL,
    fullNodeConcurrency: env.CONSENSUS_API_REQUEST_PER_SECOND,
    fullNodeRetries: 2,
    archiveNodeUrl: env.CONSENSUS_ARCHIVE_API_URL,
    archiveNodeConcurrency: env.CONSENSUS_API_REQUEST_PER_SECOND,
    archiveNodeRetries: 30,
    baseDelay: ms('1s'),
    slotStartIndexing: env.CONSENSUS_LOOKBACK_SLOT,
    slotsPerEpoch: chainConfig.beacon.slotsPerEpoch,
    archiveNodeToken: env.CONSENSUS_ARCHIVE_API_TOKEN,
  });

  const beaconTime = new BeaconTime({
    genesisTimestamp: chainConfig.beacon.genesisTimestamp,
    slotDurationMs: chainConfig.beacon.slotDuration,
    slotsPerEpoch: chainConfig.beacon.slotsPerEpoch,
    epochsPerSyncCommitteePeriod: chainConfig.beacon.epochsPerSyncCommitteePeriod,
    lookbackSlot: env.CONSENSUS_LOOKBACK_SLOT,
    delaySlotsToHead: chainConfig.beacon.delaySlotsToHead,
  });

  const validatorsStorage = new ValidatorsStorage(prisma, databaseUrl);
  const validatorsController = new ValidatorsController(
    beaconClient,
    validatorsStorage,
    beaconTime,
  );

  const epochStorage = new EpochStorage(prisma, databaseUrl);
  const slotStorage = new SlotStorage(prisma);
  const epochController = new EpochController(
    beaconClient,
    epochStorage,
    validatorsStorage,
    beaconTime,
  );

  const executionClient = new ExecutionClient({
    executionApiUrl: env.EXECUTION_API_URL,
    executionApiBkpUrl: env.EXECUTION_API_BKP_URL,
    executionApiBkpKey: env.EXECUTION_API_BKP_KEY,
    chainId: chainConfig.blockchain.chainId,
    slotDuration: chainConfig.beacon.slotDuration,
    requestsPerSecond: env.EXECUTION_API_REQUEST_PER_SECOND,
  });

  const slotController = new SlotController(
    slotStorage,
    epochStorage,
    beaconClient,
    beaconTime,
    executionClient,
  );

  // Create partition controller
  const partitionStorage = new PartitionStorage(prisma);
  const partitionController = new PartitionController(partitionStorage, beaconTime);

  // Create hourly archive storage and controller
  const hourlyArchiveStorage = new HourlyArchiveStorage(prisma);
  const hourlyArchiveController = new HourlyArchiveController(
    hourlyArchiveStorage,
    partitionController,
    beaconTime,
    chainConfig.beacon.maxAttestationDelay,
  );

  // Start indexing the beacon chain
  await validatorsController.initValidatorsWithWait(env.CONSENSUS_LOOKBACK_SLOT);

  // Initialize all XState machines (hourly archive controller is passed, actor created inside)
  await initXstateMachines(
    epochController,
    partitionController,
    beaconTime,
    chainConfig.beacon.slotDuration,
    chainConfig.beacon.slotsPerEpoch,
    slotController,
    validatorsController,
    hourlyArchiveController,
  );
}

main().catch((e) => {
  logger.error('', e);
  cleanup()
    .then(() => {
      process.exit(1);
    })
    .catch(() => {
      process.exit(1);
    });
});
