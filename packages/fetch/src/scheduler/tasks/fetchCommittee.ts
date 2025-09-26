import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';

import createLogger, { CustomLogger } from '@/src/lib/pino.js';
import { scheduler } from '@/src/lib/scheduler.js';
import { TaskOptions } from '@/src/scheduler/tasks/types.js';
import { getEpochFromSlot, getOldestLookbackSlot } from '@/src/services/consensus/utils/misc.js';
import { getSlotNumberFromTimestamp } from '@/src/services/consensus/utils/time.deprecated.js';
import {
  db_upsertEpoch,
  db_getLastEpochWithCommittees,
  db_getLastSlotWithAttestations,
} from '@/src/utils/db.js';

/* 
  This function fetches the new committees for the next epoch.
  Upserts the epoch to the database.
 */
async function fetchNewCommittees(logger: CustomLogger): Promise<void> {
  // calculate slot and epoch for head and oldestLookback
  const oldestLookbackSlot = getOldestLookbackSlot();
  const oldestLookbackEpoch = getEpochFromSlot(oldestLookbackSlot);
  const now = new Date();
  const headSlot = getSlotNumberFromTimestamp(now.getTime());
  const headEpoch = getEpochFromSlot(headSlot);

  // get the next epoch to fetch
  const lastEpochWithCommittees = await db_getLastEpochWithCommittees();
  const epochToFetch = lastEpochWithCommittees
    ? lastEpochWithCommittees.epoch + 1
    : oldestLookbackEpoch;
  logger.setContext(`Epoch: ${epochToFetch}`);

  // Skip if the committee data for the epoch is not yet available
  if (epochToFetch > headEpoch + 1) {
    logger.info(`Skipping, epoch ${epochToFetch} is too far in the future`);
    return;
  }

  // skip if the fetch attestations process is delayed to avoid making Committee table too big
  const lastSlotWithAttestations = await db_getLastSlotWithAttestations();
  const lastEpochWithAttestations = await getEpochFromSlot(
    lastSlotWithAttestations?.slot || oldestLookbackSlot,
  );
  if (epochToFetch - lastEpochWithAttestations > 25) {
    logger.info(`Skipping, attestations process is too delayed.`);
    return;
  }

  // create epoch
  await db_upsertEpoch(epochToFetch);

  // fetch committee for the epoch
  logger.info(`FetchCommittee: Distance to head: ${headEpoch - epochToFetch} epochs`);
  //await fetchCommittee(logger, epochToFetch);

  logger.info(`Done!`);
}

export function scheduleFetchCommittee({
  id,
  logsEnabled,
  intervalMs,
  runImmediately,
  preventOverrun,
}: TaskOptions) {
  const logger = createLogger(id, logsEnabled);

  const task = new AsyncTask(`${id}_task`, () =>
    fetchNewCommittees(logger).catch((e) => {
      logger.error('TASK-CATCH', e);
    }),
  );

  const job = new SimpleIntervalJob(
    { milliseconds: intervalMs, runImmediately: runImmediately },
    task,
    {
      id: id,
      preventOverrun: preventOverrun,
    },
  );

  scheduler.addSimpleIntervalJob(job);
}
