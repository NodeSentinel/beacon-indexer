import { PrismaClient } from '@beacon-indexer/db';
import ms from 'ms';

import { env, chainConfig } from '@/src/lib/env.js';
import createLogger from '@/src/lib/pino.js';
import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import initXstateMachines from '@/src/xstate/index.js';
import { getMultiMachineLogger } from '@/src/xstate/multiMachineLogger.js';

const logger = createLogger('index file');

const prisma = new PrismaClient({
  datasourceUrl: `${env.DATABASE_URL}&pool_timeout=0`,
});

async function main() {
  await prisma.$connect();

  // Initialize dependencies
  const beaconClient = new BeaconClient({
    fullNodeUrl: env.CONSENSUS_FULL_API_URL,
    fullNodeConcurrency: env.CONSENSUS_API_REQUEST_PER_SECOND,
    fullNodeRetries: 10,
    archiveNodeUrl: env.CONSENSUS_ARCHIVE_API_URL,
    archiveNodeConcurrency: env.CONSENSUS_API_REQUEST_PER_SECOND,
    archiveNodeRetries: 30,
    baseDelay: ms('1s'),
    slotStartIndexing: env.CONSENSUS_LOOKBACK_SLOT,
  });

  const beaconTime = new BeaconTime({
    genesisTimestamp: chainConfig.beacon.genesisTimestamp,
    slotDurationMs: chainConfig.beacon.slotDuration,
    slotsPerEpoch: chainConfig.beacon.slotsPerEpoch,
    epochsPerSyncCommitteePeriod: chainConfig.beacon.epochsPerSyncCommitteePeriod,
    slotStartIndexing: env.CONSENSUS_LOOKBACK_SLOT,
  });

  const validatorsStorage = new ValidatorsStorage(prisma);
  const validatorsController = new ValidatorsController(beaconClient, validatorsStorage);

  const epochStorage = new EpochStorage(prisma);
  const epochController = new EpochController(beaconClient, epochStorage, beaconTime);

  // Start indexing the beacon chain
  await validatorsController.initValidators();

  await initXstateMachines(epochController, beaconTime, chainConfig.beacon.slotDuration);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    getMultiMachineLogger().done();
    process.exit(0);
  });
}

main()
  .catch((e) => {
    logger.error('', e);
    getMultiMachineLogger().done();
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
