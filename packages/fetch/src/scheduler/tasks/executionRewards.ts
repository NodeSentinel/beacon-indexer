import { SimpleIntervalJob, AsyncTask } from 'toad-scheduler';

import { chainConfig } from '@/src/lib/env.js';
import createLogger, { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { scheduler } from '@/src/lib/scheduler.js';
import { TaskOptions } from '@/src/scheduler/tasks/types.js';
import { fetchExecutionRewards } from '@/src/services/consensus/_feed/fetchExecutionRewards.js';

const prisma = getPrisma();

const _fetchExecutionRewardsTask = async (logger: CustomLogger) => {
  const latestReward = await prisma.executionRewards.findFirst({
    orderBy: { blockNumber: 'desc' },
  });

  let blockToQuery: number = -1;

  if (latestReward) {
    const now = new Date();
    const millisecondsSinceLastBlock = Math.abs(now.getTime() - latestReward.timestamp.getTime());

    // A block can be missed for a slot, so we allow to fetch only 3 blocks before the current
    if (millisecondsSinceLastBlock < chainConfig.beacon.slotDuration * 3) {
      logger.info(`Skipping, too close to the head.`);
      return;
    }
    blockToQuery = latestReward.blockNumber + 1;
  }

  logger.setContext(`for block ${blockToQuery}`);

  await fetchExecutionRewards(logger, blockToQuery);
};

export function scheduleFetchExecutionRewards({
  id,
  logsEnabled,
  intervalMs,
  runImmediately,
  preventOverrun,
}: TaskOptions) {
  const logger = createLogger(id, logsEnabled);

  const task = new AsyncTask(`${id}_task`, () => {
    return _fetchExecutionRewardsTask(logger).catch((e) => logger.error('TASK-CATCH', e.message));
  });

  scheduler.addSimpleIntervalJob(
    new SimpleIntervalJob({ milliseconds: intervalMs, runImmediately }, task, {
      id,
      preventOverrun,
    }),
  );
}
