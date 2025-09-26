import { addHours, subHours } from 'date-fns';
import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';

import createLogger, { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { scheduler } from '@/src/lib/scheduler.js';
import { TaskOptions } from '@/src/scheduler/tasks/types.js';
import { summarizeHourly } from '@/src/services/consensus/_feed/summarizeHourly.js';
import { getOldestLookbackSlot } from '@/src/services/consensus/utils/misc.js';
import { getTimestampFromSlotNumber } from '@/src/services/consensus/utils/time.deprecated.js';

const prisma = getPrisma();

const oldestLookbackSlotDate = new Date(getTimestampFromSlotNumber(getOldestLookbackSlot()));

/* 
  This function summarizes the hourly validator stats.
  To avoid making grow the DB size, we summarize the data every hour.
  This process gathers the data from two tables, Committee and HourlyValidatorStats.
  - In committee we have the missed attestations for each validator.
  - In HourlyValidatorStats we have the rewards for attestations duties.
  - In HourlyBlockAndSyncRewards we have the rewards for producing a block and for sync duties.
*/
async function summarizeHourlyTask(logger: CustomLogger) {
  const summary = await prisma.lastSummaryUpdate.findFirst();

  const lastSummaryDate = summary?.hourlyValidatorStats ?? oldestLookbackSlotDate;
  const nextSummaryDate = addHours(lastSummaryDate, 1);

  const now = new Date();
  const oneHourBefore = subHours(now, 1);

  logger.info(`
lastSummaryDate: ${lastSummaryDate}. 
nextSummaryDate: ${nextSummaryDate}. 
oneHourBefore: ${oneHourBefore}.`);

  // We need to wait for a full hour of data before summarizing
  // because we use this data to calculate:
  // 1. The last hour's performance metrics
  // 2. The number of missed validators in the last hour
  //
  // For example, if current time is 12:00, we can only safely
  // process and summarize data up to 11:00, since we need
  // complete data for the entire hour (11:00-12:00) of data
  if (nextSummaryDate > oneHourBefore) {
    logger.info('Skipping, data is too recent (less than 1 hour old)');
    return;
  }

  await summarizeHourly(lastSummaryDate, nextSummaryDate, logger);

  logger.info('Done.');
}

export function scheduleSummarizeHourly({
  id,
  logsEnabled,
  intervalMs,
  runImmediately,
  preventOverrun,
}: TaskOptions) {
  const logger = createLogger(id, logsEnabled);

  const task = new AsyncTask(`${id}_task`, () =>
    summarizeHourlyTask(logger).catch((e) => {
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
