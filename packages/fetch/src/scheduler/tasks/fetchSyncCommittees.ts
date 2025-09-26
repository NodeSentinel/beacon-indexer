import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';

import { chainConfig } from '@/src/lib/env.js';
import createLogger, { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { scheduler } from '@/src/lib/scheduler.js';
import { TaskOptions } from '@/src/scheduler/tasks/types.js';
import { beacon_getSyncCommittees } from '@/src/services/consensus/_feed/endpoints.js';
import { getEpochFromSlot, getOldestLookbackSlot } from '@/src/services/consensus/utils/misc.js';
import {
  getEpochNumberFromTimestamp,
  getSyncCommitteePeriodStartEpoch,
} from '@/src/services/consensus/utils/time.deprecated.js';
import { db_getLastProcessedSyncCommittee } from '@/src/utils/db.js';

const prisma = getPrisma();

/* 
  This function fetches the sync committees.
  create an entry in the SyncCommittee table for the epoch from-to.
 */
async function fetchSyncCommitteesTask(logger: CustomLogger) {
  const oldestLookbackSlot = getOldestLookbackSlot();
  const oldestLookbackEpoch = getEpochFromSlot(oldestLookbackSlot);

  const currentEpoch = getEpochNumberFromTimestamp(Date.now());

  // Find the last processed sync committee
  const lastProcessedSyncCommittee = await db_getLastProcessedSyncCommittee();

  // Calculate the epoch to fetch
  const epochToFetchTmp = lastProcessedSyncCommittee
    ? lastProcessedSyncCommittee.toEpoch + 1
    : oldestLookbackEpoch;
  // Ensure we're fetching from the start of a sync committee period
  const epochToFetch = getSyncCommitteePeriodStartEpoch(epochToFetchTmp);

  logger.warn(`
currentEpoch: ${currentEpoch}
lastProcessedSyncCommittee - from: ${lastProcessedSyncCommittee?.fromEpoch} to: ${lastProcessedSyncCommittee?.toEpoch}
epochToFetchTmp: ${epochToFetchTmp}
epochToFetch: ${epochToFetch}`);

  // Check if the epoch we want to fetch has already been processed
  if (lastProcessedSyncCommittee && epochToFetch <= lastProcessedSyncCommittee.toEpoch) {
    logger.info(
      `Epoch ${epochToFetch} has already been processed (up to ${lastProcessedSyncCommittee.toEpoch})`,
    );
    return;
  }

  logger.setContext(`EpochToFetch: ${epochToFetch}`);

  if (epochToFetch > currentEpoch) {
    logger.info(`To soon to fetch`);
    return;
  }

  logger.info('Fetching sync committee data');

  try {
    // Fetch sync committee data for the period
    const syncCommitteeData = await beacon_getSyncCommittees(epochToFetch);

    // Store the sync committee data in the database
    await prisma.syncCommittee.create({
      data: {
        fromEpoch: epochToFetch,
        toEpoch: epochToFetch + chainConfig.beacon.epochsPerSyncCommitteePeriod - 1,
        validators: syncCommitteeData.validators,
        validatorAggregates: syncCommitteeData.validator_aggregates,
      },
    });

    logger.info('Successfully stored sync committee data');
  } catch (error) {
    logger.error('Failed to fetch or store sync committee data', error);
    throw error;
  }
}

export function scheduleFetchSyncCommittees({
  id,
  logsEnabled,
  intervalMs,
  runImmediately,
  preventOverrun,
}: TaskOptions) {
  const logger = createLogger(id, logsEnabled);
  const task = new AsyncTask(`${id}_task`, () => {
    return fetchSyncCommitteesTask(logger).catch((e) => logger.error('TASK-CATCH', e));
  });
  scheduler.addSimpleIntervalJob(
    new SimpleIntervalJob({ milliseconds: intervalMs, runImmediately }, task, {
      id,
      preventOverrun,
    }),
  );
}
