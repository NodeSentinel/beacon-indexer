import { Prisma } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import ms from 'ms';

import { chainConfig } from '@/src/lib/env.js';
import { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { calculateSlotRange } from '@/src/services/consensus/utils/misc.js';
import {
  getEpochNumberFromTimestamp,
  getTimestampFromSlotNumber,
} from '@/src/services/consensus/utils/time.deprecated.js';
import { convertToUTC } from '@/src/utils/date/index.js';
import { updateLastSummaryUpdate } from '@/src/utils/db.js';

const prisma = getPrisma();

async function hasUnprocessedSlots(endSlot: number): Promise<boolean> {
  const slot = await prisma.slot.findUnique({
    where: {
      slot: endSlot,
      attestationsFetched: true,
      consensusRewardsFetched: true,
      syncRewardsFetched: true,
    },
  });
  return slot == null;
}

async function hasUnprocessedBeaconRewards(endSlot: number): Promise<boolean> {
  const endSlotTime = getTimestampFromSlotNumber(endSlot);
  const endEpoch = getEpochNumberFromTimestamp(endSlotTime);

  const beaconRewards = await prisma.epoch.findFirst({
    // We need at least one beacon reward epoch processed after the endSlot
    // because we will remove all the beacon rewards before the endSlot
    // and if the table is empty, fetching restarts from env.BEACON_LOOKBACK_EPOCH
    where: { epoch: { gt: endEpoch }, rewardsFetched: true },
  });

  return beaconRewards == null;
}

async function aggregateMissedAttestations(startSlot: number, endSlot: number) {
  return prisma.committee.groupBy({
    by: ['validatorIndex'],
    where: {
      AND: [
        { slot: { gte: startSlot, lte: endSlot } },
        {
          OR: [
            { attestationDelay: null },
            { attestationDelay: { gt: chainConfig.beacon.maxAttestationDelay } },
          ],
        },
      ],
    },
    _count: {
      validatorIndex: true,
    },
  });
}
export type ValidatorMissedAttestations = Awaited<
  ReturnType<typeof aggregateMissedAttestations>
>[number];

async function processCommitteeValidatorsBatch(
  tx: Prisma.TransactionClient,
  batch: ValidatorMissedAttestations[],
  hour: number,
  date: string,
) {
  const values = batch
    .map((stat) => `(${stat.validatorIndex}, ${hour}, '${date}', ${stat._count.validatorIndex})`)
    .join(',');

  // if a validator haven't had rewards, the row won't exist
  await tx.$executeRawUnsafe(`
    INSERT INTO "HourlyValidatorStats" ("validatorIndex", "hour", "date", "attestationsMissed")
    VALUES ${values}
    ON CONFLICT ("validatorIndex", "hour", "date") 
    DO UPDATE SET "attestationsMissed" = EXCLUDED."attestationsMissed"
  `);
}

async function summarizeAtomicTransaction(
  validatorsMissedAttestations: ValidatorMissedAttestations[],
  hour: number,
  date: string,
  endTime: Date,
  logger: CustomLogger,
) {
  const BATCH_SIZE = 5000;

  await prisma.$transaction(
    async (tx) => {
      if (validatorsMissedAttestations.length > 0) {
        const missedAttestationBatches = chunk(validatorsMissedAttestations, BATCH_SIZE);
        for (const batch of missedAttestationBatches) {
          await processCommitteeValidatorsBatch(tx, batch, hour, date);
        }

        await updateLastSummaryUpdate('hourlyValidatorStats', endTime, tx);
      } else {
        logger.warn('ABORT: No committee validators to process');
      }
    },
    { timeout: ms('10m') },
  );
}

export async function summarizeHourly(
  startTime: Date,
  endTime: Date,
  logger: CustomLogger,
): Promise<void> {
  const { startSlot, endSlot } = calculateSlotRange(startTime, endTime);

  logger.info(`StartSlot: ${startSlot}, EndSlot: ${endSlot}`);

  // Check if all slots up to endSlot have been processed
  // checks for attestations, block rewards and sync rewards
  const unprocessedSlots = await hasUnprocessedSlots(endSlot);
  if (unprocessedSlots) {
    logger.info(`Some slots before ${endSlot} are not fully processed. Skipping summarization.`);
    return;
  }

  // Check if all epoch rewards up to endEpoch have been processed
  // checks for beacon rewards (head, target, source, inactivity)
  const unprocessedBeaconRewards = await hasUnprocessedBeaconRewards(endSlot);
  if (unprocessedBeaconRewards) {
    logger.info(
      `Some beacon rewards before slot ${endSlot} are not fully processed. Skipping summarization.`,
    );
    return;
  }

  // The only task we need to do is to aggregate the missed attestations from Committee table to HourlyValidatorStats.
  // Epoch rewards (head, target, source, inactivity) are already aggregated while fetching the data in HourlyValidatorStats.
  // block rewards and sync rewards are already aggregated while fetching the data in HourlyBlockAndSyncRewards.
  const validatorsMissedAttestations = await aggregateMissedAttestations(startSlot, endSlot);

  // we use hour and date in UTC to be consistent with the db timestamp
  const { hour, date } = convertToUTC(startTime);

  logger.info(`Ready to summarize.`);

  // update the hourly validator stats
  await summarizeAtomicTransaction(validatorsMissedAttestations, hour, date, endTime, logger);
}
