import type { Api, RawApi } from 'grammy';
import { AsyncTask, SimpleIntervalJob, ToadScheduler } from 'toad-scheduler';

import type { Logger } from '@/src/logger.js';
import { processUsers } from '@/src/scheduler/process-users.js';

export function startScheduler(api: Api<RawApi>, logger: Logger): () => void {
  const log = logger.child({ module: 'scheduler' });
  const scheduler = new ToadScheduler();
  let abortController: AbortController | null = null;

  const task = new AsyncTask('notify-users', async () => {
    abortController = new AbortController();
    try {
      await processUsers(api, abortController.signal, log);
    } finally {
      abortController = null;
    }
  });

  const job = new SimpleIntervalJob({ seconds: 1, runImmediately: true }, task, {
    preventOverrun: true,
  });

  scheduler.addSimpleIntervalJob(job);
  log.info('Scheduler started');

  return () => {
    log.info('Scheduler stopping');
    abortController?.abort();
    scheduler.stop();
    log.info('Scheduler stopped');
  };
}
