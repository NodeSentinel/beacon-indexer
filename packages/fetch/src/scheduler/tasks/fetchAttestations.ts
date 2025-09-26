import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';

import { chainConfig } from '@/src/lib/env.js';
import createLogger, { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { scheduler } from '@/src/lib/scheduler.js';
import { TaskOptions } from '@/src/scheduler/tasks/types.js';
import { processAttestations as _fetchAttestations } from '@/src/services/consensus/_feed/processAttestations.js';
import { getEpochFromSlot, getOldestLookbackSlot } from '@/src/services/consensus/utils/misc.js';
import { getSlotNumberFromTimestamp } from '@/src/services/consensus/utils/time.deprecated.js';
import { db_getLastSlotWithAttestations, db_hasEpochCommittees } from '@/src/utils/db.js';

const prisma = getPrisma();

export const fetchAttestationsTask = async (logger: CustomLogger) => {
  const now = new Date();
  const currentSlot = getSlotNumberFromTimestamp(now.getTime());
  const maxSlotToFetch = currentSlot - chainConfig.beacon.delaySlotsToHead;
  const oldestLookbackSlot = getOldestLookbackSlot();

  try {
    // Get the last slot for which we have attestations
    const lastProcessedSlot = await db_getLastSlotWithAttestations();
    const slotToFetch = lastProcessedSlot ? lastProcessedSlot.slot + 1 : oldestLookbackSlot;

    logger.setContext(`attestation: ${slotToFetch}`);

    // Skip if the slot to fetch is greater than the max slot to fetch
    if (slotToFetch > maxSlotToFetch) {
      logger.info(`Skipping, is greater than max slot to fetch ${maxSlotToFetch}`);
      return;
    }

    // Skip if the committees for the slot have not been fetched
    const epochToFetch = getEpochFromSlot(slotToFetch);
    const hasEpochCommittees = await db_hasEpochCommittees(epochToFetch);
    if (!hasEpochCommittees) {
      logger.info(`Skipping, committees for epoch ${epochToFetch} not fetched.`);
      return;
    }

    // TODO: move to another task (?)
    // We delete attestations that came "on-time" to reduce the amount of data in the database.
    // Attestations for slot n can come one up to one epoch later.
    // It's quite important to not delete data that could be re-inserted later.
    await prisma.committee.deleteMany({
      where: {
        slot: {
          lt: slotToFetch - chainConfig.beacon.slotsPerEpoch * 3, // some buffer just in case
        },
        attestationDelay: {
          lte: chainConfig.beacon.maxAttestationDelay,
        },
      },
    });

    return _fetchAttestations(slotToFetch, [], {});
  } catch (error) {
    logger.error('Error fetching attestations:', error);
  }
};

export function scheduleFetchAttestations({
  id,
  logsEnabled,
  intervalMs,
  runImmediately,
  preventOverrun,
}: TaskOptions) {
  const logger = createLogger(id, logsEnabled);

  const task = new AsyncTask(`${id}_task`, () => {
    return fetchAttestationsTask(logger).catch((e) => logger.error('TASK-CATCH', e));
  });

  scheduler.addSimpleIntervalJob(
    new SimpleIntervalJob({ milliseconds: intervalMs, runImmediately }, task, {
      id,
      preventOverrun,
    }),
  );
}
