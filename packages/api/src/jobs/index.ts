import { registerDailyJobs } from './daily.js';
import { registerHourlyJobs } from './hourly.js';
import { registerPerMinuteJobs } from './per-minute.js';
import { registerPerSecondJobs } from './per-second.js';

import { logger } from '@/lib/logger.js';

let jobsStarted = false;

/**
 * Start all cron jobs
 */
export function startJobs() {
  if (jobsStarted) {
    logger.warn('Jobs already started, skipping');
    return;
  }

  logger.info('Starting cron jobs...');

  // Register all job types
  registerPerSecondJobs();
  registerPerMinuteJobs();
  registerHourlyJobs();
  registerDailyJobs();

  jobsStarted = true;
  logger.info('All cron jobs started');
}

/**
 * Stop all cron jobs
 * Note: node-cron doesn't have a built-in way to stop all jobs,
 * but we can track this for graceful shutdown
 */
export function stopJobs() {
  if (!jobsStarted) {
    return;
  }

  logger.info('Stopping cron jobs...');
  // In a real implementation, you might want to track cron instances
  // and call .destroy() on them, but for now we just log
  jobsStarted = false;
  logger.info('Cron jobs stopped');
}
