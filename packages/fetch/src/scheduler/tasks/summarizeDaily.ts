import { addDays, isBefore } from 'date-fns';
import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';

import createLogger, { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { scheduler } from '@/src/lib/scheduler.js';
import { TaskOptions } from '@/src/scheduler/tasks/types.js';
import { summarizeDaily } from '@/src/services/consensus/_feed/summarizeDaily.js';
import { getOldestLookbackSlot } from '@/src/services/consensus/utils/misc.js';
import { getTimestampFromSlotNumber } from '@/src/services/consensus/utils/time.deprecated.js';
import { convertToUTC } from '@/src/utils/date/index.js';

const prisma = getPrisma();

const oldestLookbackSlotDate = new Date(getTimestampFromSlotNumber(getOldestLookbackSlot()));

async function summarizeDailyTask(logger: CustomLogger) {
  try {
    // Get the last daily summarized timestamp
    const summary = await prisma.lastSummaryUpdate.findFirst();

    // If the last summary is not in the db, use the oldest lookback slot
    const now = new Date();
    const lastSummaryDate = summary?.dailyValidatorStats ?? oldestLookbackSlotDate;

    // We need to wait 24 hours after the last summary update before processing the next summary
    // This ensures we have enough indexed data for accurate daily summaries
    const nextSummaryUpdateTime = addDays(lastSummaryDate, 1);

    logger.info(`
lastSummaryDate: ${lastSummaryDate}
nextSummaryUpdateTime: ${nextSummaryUpdateTime}
now: ${now}`);

    // Check if enough time has passed since the last summary
    if (isBefore(now, nextSummaryUpdateTime)) {
      logger.info('Skipping, not enough time has passed since last summary (need 24 hours)');
      return;
    }

    const { date, day } = convertToUTC(lastSummaryDate);

    await summarizeDaily(new Date(date), day, logger);

    logger.info('Done.');
  } catch (error) {
    logger.error('Error in summarizeAttestationsDaily task', error);
  }
}

export function scheduleSummarizeDaily({
  id,
  logsEnabled,
  intervalMs,
  runImmediately,
  preventOverrun,
}: TaskOptions) {
  const logger = createLogger(id, logsEnabled);

  const task = new AsyncTask(`${id}_task`, () =>
    summarizeDailyTask(logger).catch((e) => {
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
