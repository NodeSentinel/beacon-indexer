import type { PrismaClient } from '@beacon-indexer/db';

import { registerDailyJobs } from './daily.js';
import { registerHourlyJobs } from './hourly.js';
import { registerPerMinuteJobs } from './per-minute.js';
import { registerPerSecondJobs } from './per-second.js';

import type { Logger } from '@/lib/logger.js';

let jobsStarted = false;

/**
 * Starts the API cron jobs.
 */
export function startJobs(params: { logger: Logger; prisma: PrismaClient }) {
  if (jobsStarted) {
    params.logger.warn('Jobs already started, skipping');
    return;
  }

  params.logger.info('Starting cron jobs...');
  registerPerSecondJobs(params.logger);
  registerPerMinuteJobs(params);
  registerHourlyJobs(params.logger);
  registerDailyJobs(params.logger);
  jobsStarted = true;
  params.logger.info('All cron jobs started');
}

/**
 * Stops the API cron jobs bookkeeping.
 */
export function stopJobs(logger: Logger) {
  if (!jobsStarted) {
    return;
  }

  logger.info('Stopping cron jobs...');
  jobsStarted = false;
  logger.info('Cron jobs stopped');
}
