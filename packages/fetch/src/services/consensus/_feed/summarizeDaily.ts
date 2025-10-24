import { Prisma } from '@beacon-indexer/db';
import { addDays } from 'date-fns';
import ms from 'ms';

import { chainConfig } from '@/src/lib/env.js';
import { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { getEpochFromSlot } from '@/src/services/consensus/utils/misc.js';
import { getSlotNumberFromTimestamp } from '@/src/services/consensus/utils/time.deprecated.js';
import {
  updateLastSummaryUpdate,
  db_hasBeaconRewardsFetched,
  db_hasBlockAndSyncRewardsFetched,
  db_countRemainingHoursAfterDate,
} from '@/src/utils/db.js';

const prisma = getPrisma();

export type AggregateHourlyStats = Awaited<ReturnType<typeof aggregateHourlyStats>>[number];

interface HourlyStats {
  validatorIndex: number;
  _sum: {
    head: bigint;
    target: bigint;
    source: bigint;
    inactivity: bigint;
    missedHead: bigint;
    missedTarget: bigint;
    missedSource: bigint;
    missedInactivity: bigint;
    attestationsMissed: number;
    syncCommittee: bigint;
    blockReward: bigint;
  };
}

export async function canSummarize(dayToSummarize: Date): Promise<boolean> {
  const nextDay = addDays(dayToSummarize, 1);
  const nextDaySlot = getSlotNumberFromTimestamp(nextDay.getTime());
  const nextDaySlotWithDelay = nextDaySlot + chainConfig.beacon.slotsPerEpoch;

  // check if all epoch rewards have been fetched
  const beaconRewardsFetched = await db_hasBeaconRewardsFetched(
    getEpochFromSlot(nextDaySlotWithDelay),
  );
  if (!beaconRewardsFetched) {
    return false;
  }

  // check if all rewards for the slot have been fetched
  const syncCommitteeAndBlockRewardsFetched =
    await db_hasBlockAndSyncRewardsFetched(nextDaySlotWithDelay);
  if (!syncCommitteeAndBlockRewardsFetched) {
    return false;
  }

  // CRITICAL: Ensure that AFTER processing the daily summary and removing hourly data,
  // we will still maintain at least 24 hours of data in HourlyValidatorStats
  const remainingHoursCount = await db_countRemainingHoursAfterDate(dayToSummarize);

  // We need at least 24 hours of data remaining after the summary
  if (remainingHoursCount < 24) {
    return false;
  }

  return true;
}

export async function aggregateHourlyStats(date: Date) {
  const stats = await prisma.$queryRaw<Array<HourlyStats>>`
    WITH combined_rewards AS (
      -- Attestation (rewards and missed attestations)
      SELECT 
        "validatorIndex",
        COALESCE(head, 0) as head,
        COALESCE(target, 0) as target,
        COALESCE(source, 0) as source,
        COALESCE(inactivity, 0) as inactivity,
        COALESCE("missedHead", 0) as "missedHead",
        COALESCE("missedTarget", 0) as "missedTarget",
        COALESCE("missedSource", 0) as "missedSource",
        COALESCE("missedInactivity", 0) as "missedInactivity",
        COALESCE("attestationsMissed", 0) as "attestationsMissed",
        COALESCE("syncCommittee", 0) as "syncCommittee", -- TMP: remove this 
        COALESCE("blockReward", 0) as "blockReward" -- TMP: remove this 
      FROM "HourlyValidatorStats"
      WHERE date = ${date}
      
      UNION ALL
      
      -- Block and sync rewards 
      SELECT 
        "validatorIndex",
        0 as head,
        0 as target,
        0 as source,
        0 as inactivity,
        0 as "missedHead",
        0 as "missedTarget",
        0 as "missedSource",
        0 as "missedInactivity",
        0 as "attestationsMissed",
        COALESCE("syncCommittee", 0) as "syncCommittee",
        COALESCE("blockReward", 0) as "blockReward"
      FROM "HourlyBlockAndSyncRewards"
      WHERE date = ${date}
    )
    SELECT 
      "validatorIndex",
      json_build_object(
        'head', SUM(head),
        'target', SUM(target),
        'source', SUM(source),
        'inactivity', SUM(inactivity),
        'missedHead', SUM("missedHead"),
        'missedTarget', SUM("missedTarget"),
        'missedSource', SUM("missedSource"),
        'missedInactivity', SUM("missedInactivity"),
        'attestationsMissed', SUM("attestationsMissed"),
        'syncCommittee', SUM("syncCommittee"),
        'blockReward', SUM("blockReward")
      ) as "_sum"
    FROM combined_rewards
    GROUP BY "validatorIndex"`;

  return stats;
}

export async function removeProcessedHourlyStatsRecords(
  tx: Prisma.TransactionClient,
  date: Date,
  logger: CustomLogger,
) {
  logger.info(`Removing processed HourlyStats and HourlyBlockAndSyncRewards for ${date}`);

  await Promise.all([
    tx.hourlyValidatorStats.deleteMany({
      where: { datetime: { gte: date, lt: new Date(date.getTime() + 24 * 60 * 60 * 1000) } },
    }),
    tx.hourlyBlockAndSyncRewards.deleteMany({
      where: { date },
    }),
  ]);
}

export async function summarizeAtomicTransaction(
  hourlyStates: AggregateHourlyStats[],
  date: Date,
  logger: CustomLogger,
) {
  const BATCH_SIZE = 100000;

  await prisma.$transaction(
    async (tx) => {
      logger.info(`Creating daily validator stats`);
      for (let i = 0; i < hourlyStates.length; i += BATCH_SIZE) {
        const batch = hourlyStates.slice(i, i + BATCH_SIZE);

        await tx.dailyValidatorStats.createMany({
          data: batch.map((stat) => ({
            validatorIndex: stat.validatorIndex,
            date,
            head: stat._sum.head || null,
            target: stat._sum.target || null,
            source: stat._sum.source || null,
            inactivity: stat._sum.inactivity || null,
            missedHead: stat._sum.missedHead || null,
            missedTarget: stat._sum.missedTarget || null,
            missedSource: stat._sum.missedSource || null,
            missedInactivity: stat._sum.missedInactivity || null,
            attestationsMissed: stat._sum.attestationsMissed || null,
            syncCommittee: stat._sum.syncCommittee || null,
            blockReward: stat._sum.blockReward || null,
          })),
        });
      }

      // Always update and clean up after successful processing
      await updateLastSummaryUpdate('dailyValidatorStats', addDays(date, 1), tx);
      await removeProcessedHourlyStatsRecords(tx, date, logger);
    },
    { timeout: ms('5m') },
  );

  logger.info('Done.');
}

export async function summarizeDaily(
  lastSummaryUpdate: Date,
  lastSummaryUpdateDay: number,
  logger: CustomLogger,
): Promise<void> {
  if (!(await canSummarize(lastSummaryUpdate))) {
    logger.info(`Missing rewards stats for ${lastSummaryUpdate}, skipping`);
    return;
  }

  // Aggregate hourly stats
  logger.info(`Aggregating hourly stats`);
  const hourlyStats = await aggregateHourlyStats(lastSummaryUpdate);
  logger.info(`Aggregated ${hourlyStats.length} hourly stats`);

  // update the daily validator stats
  await summarizeAtomicTransaction(hourlyStats, lastSummaryUpdate, logger);
}
