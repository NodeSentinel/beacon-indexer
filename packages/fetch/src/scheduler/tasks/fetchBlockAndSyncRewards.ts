import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';

import { chainConfig } from '@/src/lib/env.js';
import createLogger, { CustomLogger } from '@/src/lib/pino.js';
import { scheduler } from '@/src/lib/scheduler.js';
import { TaskOptions } from '@/src/scheduler/tasks/types.js';
import { fetchBlockAndSyncRewards as _fetchBlockAndSyncRewards } from '@/src/services/consensus/_feed/fetchBlockAndSyncRewards.js';
import { getOldestLookbackSlot } from '@/src/services/consensus/utils/misc.js';
import { getSlotNumberFromTimestamp } from '@/src/services/consensus/utils/time.deprecated.js';
import {
  db_areValidatorsFetched,
  db_getLastSlotWithSyncRewards,
  db_getSlotByNumber,
} from '@/src/utils/db.js';

export const fetchBlockAndSyncRewardsTask = async (logger: CustomLogger) => {
  const now = new Date();
  const currentSlot = getSlotNumberFromTimestamp(now.getTime());
  const maxSlotToFetch = currentSlot - chainConfig.beacon.delaySlotsToHead;

  // Get slot to fetch
  const oldestLookbackSlot = getOldestLookbackSlot();
  const lastProcessedSlot = await db_getLastSlotWithSyncRewards();
  const slotToFetch = lastProcessedSlot ? lastProcessedSlot.slot + 1 : oldestLookbackSlot;

  logger.setContext(`slot: ${slotToFetch}`);

  if (slotToFetch > maxSlotToFetch) {
    logger.info(`Skipping, greater than max slot to fetch ${maxSlotToFetch}`);
    return;
  }

  if (!db_areValidatorsFetched()) {
    logger.info(`Skipping, validators not fetched`);
    return;
  }

  const slot = await db_getSlotByNumber(slotToFetch);
  if (!slot) {
    logger.info(`Skipping, slot ${slotToFetch} not found in the database`);
    return;
  }

  return _fetchBlockAndSyncRewards(slotToFetch, 1, []);
};

/* 
  This function get the sync committee and block rewards for a given slot.
  Data is saved to the HourlyBlockAndSyncRewards table for the Date and Hour of the slot.
  It might collide with the existing data in the table as missedAttestations and attestations rewards are handled by other task ans saved to the same table.
  If a collision happens, existing data is kept and syncCommittee and blockReward are added to the existing data.
  
  It get's the last processed slot from the database and then fetches the rewards for the next slot. If the slot is greater than the max slot to fetch, it skips.
*/
export function scheduleFetchBlockAndSyncRewards({
  id,
  logsEnabled,
  intervalMs,
  runImmediately,
  preventOverrun,
}: TaskOptions) {
  const logger = createLogger(id, logsEnabled);
  const task = new AsyncTask(`${id}_task`, () => {
    return fetchBlockAndSyncRewardsTask(logger).catch((e) => logger.error('TASK-CATCH', e));
  });
  scheduler.addSimpleIntervalJob(
    new SimpleIntervalJob({ milliseconds: intervalMs, runImmediately }, task, {
      id,
      preventOverrun,
    }),
  );
}
