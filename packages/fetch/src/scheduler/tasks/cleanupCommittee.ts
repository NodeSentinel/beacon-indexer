import { SimpleIntervalJob, AsyncTask } from 'toad-scheduler';

import createLogger from '@/src/lib/pino.js';
import { scheduler } from '@/src/lib/scheduler.js';
import { TaskOptions } from '@/src/scheduler/tasks/types.js';
import { cleanupCommittee } from '@/src/services/consensus/_feed/cleanupCommittee.js';

export function scheduleCleanupCommittee({
  id,
  logsEnabled,
  intervalMs,
  runImmediately,
  preventOverrun,
}: TaskOptions) {
  const logger = createLogger(id, logsEnabled);

  const task = new AsyncTask(`${id}_task`, () =>
    cleanupCommittee(logger).catch((e) => {
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
