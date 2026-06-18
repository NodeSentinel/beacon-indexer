import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import ms from 'ms';

import { chainConfig, env } from '@/src/lib/env.js';
import createLogger from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { ChainStatsController } from '@/src/services/consensus/controllers/chainStats.js';
import { ClaimableWithdrawalsController } from '@/src/services/consensus/controllers/claimableWithdrawals.js';
import { DailyArchiveController } from '@/src/services/consensus/controllers/dailyArchive.js';
import { DailyArchiveDetailCleanupController } from '@/src/services/consensus/controllers/dailyArchiveDetailCleanup.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { HourlyArchiveController } from '@/src/services/consensus/controllers/hourlyArchive.js';
import { IncidentRewardsController } from '@/src/services/consensus/controllers/incidentRewards.js';
import { IndexerConfigController } from '@/src/services/consensus/controllers/indexerConfig.js';
import { MonthlyArchiveController } from '@/src/services/consensus/controllers/monthlyArchive.js';
import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { ChainStatsStorage } from '@/src/services/consensus/storage/chainStats.js';
import { ClaimableWithdrawalsStorage } from '@/src/services/consensus/storage/claimableWithdrawals.js';
import { DailyArchiveStorage } from '@/src/services/consensus/storage/dailyArchive.js';
import { DailyArchiveDetailCleanupStorage } from '@/src/services/consensus/storage/dailyArchiveDetailCleanup.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { HourlyArchiveStorage } from '@/src/services/consensus/storage/hourlyArchive.js';
import { IncidentRewardsStorage } from '@/src/services/consensus/storage/incidentRewards.js';
import { IndexerConfigStorage } from '@/src/services/consensus/storage/indexerConfig.js';
import { MonthlyArchiveStorage } from '@/src/services/consensus/storage/monthlyArchive.js';
import { PartitionStorage } from '@/src/services/consensus/storage/partition.js';
import { SlotStorage } from '@/src/services/consensus/storage/slot.js';
import { SnapshotStorage } from '@/src/services/consensus/storage/snapshot.js';
import { ValidatorActivityStatusStorage } from '@/src/services/consensus/storage/validatorActivityStatus.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { ExecutionClient } from '@/src/services/execution/execution.js';
import { GnosisWithdrawableAmountsReader } from '@/src/services/gnosis/withdrawableAmounts.js';
import initXstateMachines from '@/src/xstate/index.js';

const logger = createLogger('index file');

const prisma = getPrisma();

// Cleanup function to ensure Prisma disconnects properly
async function cleanup() {
  try {
    await EpochStorage.closePgPool();
    await ValidatorsStorage.closePgPool();
    await prisma.$disconnect();
    logger.info('Database disconnected successfully');
  } catch (error) {
    logger.error('Error disconnecting from database:', error);
  }
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
    fullNodeRetries: 1,
    archiveNodeUrl: env.CONSENSUS_ARCHIVE_API_URL,
    archiveNodeConcurrency: env.CONSENSUS_API_REQUEST_PER_SECOND,
    archiveNodeRetries: 2,
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

  const validatorsStorage = new ValidatorsStorage(prisma, env.DATABASE_URL);
  const validatorsController = new ValidatorsController(
    beaconClient,
    validatorsStorage,
    beaconTime,
  );

  const epochStorage = new EpochStorage(prisma, env.DATABASE_URL);
  const slotStorage = new SlotStorage(prisma);
  const epochController = new EpochController(
    beaconClient,
    epochStorage,
    validatorsStorage,
    beaconTime,
  );

  const executionClient = new ExecutionClient({
    mainExecutionRpc: env.MAIN_EXECUTION_RPC,
    bkpExecutionRpc: env.BKP_EXECUTION_RPC,
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

  // Create daily archive storage and controller
  const dailyArchiveStorage = new DailyArchiveStorage(prisma);
  const lookbackSlotTimestamp = beaconTime.getTimestampFromSlotNumber(env.CONSENSUS_LOOKBACK_SLOT);
  const dailyArchiveController = new DailyArchiveController(
    dailyArchiveStorage,
    lookbackSlotTimestamp,
  );
  const dailyArchiveDetailCleanupController = new DailyArchiveDetailCleanupController(
    new DailyArchiveDetailCleanupStorage(prisma, env.ARCHIVE_DETAIL_RETENTION_DAYS),
  );

  // Create monthly archive storage and controller
  const monthlyArchiveStorage = new MonthlyArchiveStorage(prisma);
  const monthlyArchiveController = new MonthlyArchiveController(
    monthlyArchiveStorage,
    lookbackSlotTimestamp,
  );

  // Create chain stats storage and controller
  const chainStatsStorage = new ChainStatsStorage(prisma);
  const chainStatsController = new ChainStatsController(chainStatsStorage, beaconTime);

  // Create snapshot storage and controller
  const snapshotStorage = new SnapshotStorage(prisma);
  const snapshotController = new SnapshotController(snapshotStorage, beaconTime);
  const claimableWithdrawalsController =
    env.CHAIN === 'gnosis' && chainConfig.blockchain.scDepositAddress
      ? new ClaimableWithdrawalsController({
          chain: env.CHAIN,
          reader: new GnosisWithdrawableAmountsReader({
            bkpRpcUrl: env.BKP_EXECUTION_RPC,
            depositContractAddress: chainConfig.blockchain.scDepositAddress,
            mainRpcUrl: env.MAIN_EXECUTION_RPC,
          }),
          storage: new ClaimableWithdrawalsStorage(prisma),
        })
      : undefined;

  // Create incident storage and tracker controller
  const incidentRewardsStorage = new IncidentRewardsStorage(prisma, {
    slotsPerEpoch: chainConfig.beacon.slotsPerEpoch,
  });
  const incidentRewardsController = new IncidentRewardsController(
    incidentRewardsStorage,
    slotStorage,
    beaconTime,
  );

  const validatorActivityStatusStorage = new ValidatorActivityStatusStorage(
    prisma,
    {
      genesisTimeSec: Math.floor(chainConfig.beacon.genesisTimestamp / 1000),
      secPerSlot: Math.floor(chainConfig.beacon.slotDuration / 1000),
    },
    chainConfig.beacon.slotsPerEpoch,
  );
  const validatorActivityStatusController = new ValidatorActivityStatusController(
    validatorActivityStatusStorage,
    slotStorage,
  );

  // Start indexing the beacon chain
  await validatorsController.initValidatorsWithWait(env.CONSENSUS_LOOKBACK_SLOT);

  // Initialize all XState machines (hourly archive and chain stats controllers are passed, actors created inside)
  initXstateMachines(
    epochController,
    partitionController,
    beaconTime,
    chainConfig.beacon.slotDuration,
    chainConfig.beacon.slotsPerEpoch,
    slotController,
    validatorsController,
    hourlyArchiveController,
    dailyArchiveController,
    dailyArchiveDetailCleanupController,
    monthlyArchiveController,
    chainStatsController,
    snapshotController,
    incidentRewardsController,
    validatorActivityStatusController,
    env.CHAIN,
    chainConfig.beacon.maxAttestationDelay,
    chainConfig.beacon.delaySlotsToHead,
    chainConfig.beacon.missedAttestationsForInactivity,
    claimableWithdrawalsController,
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
