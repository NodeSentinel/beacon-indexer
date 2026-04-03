import type { Api, RawApi } from 'grammy';
import { AsyncTask, SimpleIntervalJob, ToadScheduler } from 'toad-scheduler';

import type { Logger } from '@/src/logger.js';
import { processNotifications } from '@/src/scheduler/process-notifications.js';
import { processUsers } from '@/src/scheduler/process-users.js';

export function startScheduler(api: Api<RawApi>, logger: Logger): () => void {
  const log = logger.child({ module: 'scheduler' });
  const scheduler = new ToadScheduler();
  let notificationsAbortController: AbortController | null = null;
  let usersAbortController: AbortController | null = null;

  const task = new AsyncTask('notify-users', async () => {
    usersAbortController = new AbortController();
    try {
      await processUsers(api, usersAbortController.signal, log);
    } finally {
      usersAbortController = null;
    }
  });

  const job = new SimpleIntervalJob({ seconds: 1, runImmediately: true }, task, {
    preventOverrun: true,
  });

  const notificationsTask = new AsyncTask('process-notifications', async () => {
    notificationsAbortController = new AbortController();
    try {
      await processNotifications(api, notificationsAbortController.signal, log);
    } finally {
      notificationsAbortController = null;
    }
  });

  const notificationsJob = new SimpleIntervalJob(
    { seconds: 5, runImmediately: true },
    notificationsTask,
    {
      preventOverrun: true,
    },
  );

  scheduler.addSimpleIntervalJob(job);
  scheduler.addSimpleIntervalJob(notificationsJob);
  log.info('Scheduler started');

  return () => {
    log.info('Scheduler stopping');
    usersAbortController?.abort();
    notificationsAbortController?.abort();
    scheduler.stop();
    log.info('Scheduler stopped');
  };
}
