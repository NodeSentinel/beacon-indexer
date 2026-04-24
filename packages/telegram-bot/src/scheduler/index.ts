import { AsyncTask, SimpleIntervalJob, ToadScheduler } from 'toad-scheduler';

import type { Logger } from '@/src/logger.js';
import type { Api, RawApi } from 'grammy';

import { processIncidentNotifications } from '@/src/scheduler/process-incident-notifications.js';
// import { processNotifications } from '@/src/scheduler/process-notifications.js';
import { processUsers } from '@/src/scheduler/process-users.js';

export function startScheduler(api: Api<RawApi>, logger: Logger): () => void {
  const log = logger.child({ module: 'scheduler' });
  const scheduler = new ToadScheduler();
  let incidentNotificationsAbortController: AbortController | null = null;
  // let notificationsAbortController: AbortController | null = null;
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

  const incidentNotificationsTask = new AsyncTask('process-incident-notifications', async () => {
    incidentNotificationsAbortController = new AbortController();
    try {
      await processIncidentNotifications(api, incidentNotificationsAbortController.signal, log);
    } finally {
      incidentNotificationsAbortController = null;
    }
  });

  const incidentNotificationsJob = new SimpleIntervalJob(
    { seconds: 5, runImmediately: true },
    incidentNotificationsTask,
    {
      preventOverrun: true,
    },
  );

  // Queue notifications are paused while incident notifications are rolled out.
  // const notificationsTask = new AsyncTask('process-notifications', async () => {
  //   notificationsAbortController = new AbortController();
  //   try {
  //     await processNotifications(api, notificationsAbortController.signal, log);
  //   } finally {
  //     notificationsAbortController = null;
  //   }
  // });
  //
  // const notificationsJob = new SimpleIntervalJob(
  //   { seconds: 5, runImmediately: true },
  //   notificationsTask,
  //   {
  //     preventOverrun: true,
  //   },
  // );

  scheduler.addSimpleIntervalJob(job);
  scheduler.addSimpleIntervalJob(incidentNotificationsJob);
  // scheduler.addSimpleIntervalJob(notificationsJob);
  log.info('Scheduler started');

  return () => {
    log.info('Scheduler stopping');
    usersAbortController?.abort();
    incidentNotificationsAbortController?.abort();
    // notificationsAbortController?.abort();
    scheduler.stop();
    log.info('Scheduler stopped');
  };
}
