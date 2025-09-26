// import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';

// import { fetchAttestationsRewards } from '@/src/consensus/_feed/fetchAttestationsRewards.js'; // Assuming this function exists
// import { fetchValidators } from '@/src/consensus/_feed/fetchValidators.js';
// import { fetchValidatorsBalances } from '@/src/consensus/_feed/fetchValidatorsBalances.js';
// import { getEpochSlots, getOldestLookbackSlot } from '@/src/consensus/utils/misc.js';
// import {
//   getEpochNumberFromTimestamp,
//   getSlotNumberFromTimestamp,
// } from '@/src/consensus/utils/time.js';
// import { env } from '@/src/lib/env.js';
// import createLogger, { CustomLogger } from '@/src/lib/pino.js';
// import { getPrisma } from '@/src/lib/prisma.js';
// import { scheduler } from '@/src/lib/scheduler.js';
// import { TaskOptions } from '@/src/scheduler/tasks/types.js';
// import { db_getEpochByNumber, db_getLastProcessedEpoch } from '@/src/utils/db.js';

// const prisma = getPrisma();

// /*
//   This function fetches Epoch information.
//   Purpose:
//   * Get validators info, validators effective balances, and beacon rewards for the epoch. (to calculate missed rewards)
//   * TODO: move all the fetchers related to epoch to this function
// */
// async function fetchEpochInfoTask(logger: CustomLogger) {
//   const currentEpoch = getEpochNumberFromTimestamp(new Date().getTime());
//   const currentSlot = getSlotNumberFromTimestamp(new Date().getTime());

//   // get the last processed epoch with:
//   // validatorsInfoFetched: true
//   // validatorsBalancesFetched: true
//   // rewardsFetched: true
//   const lastProcessedEpoch = await db_getLastProcessedEpoch();
//   const oldestLookbackEpoch = Math.floor(getOldestLookbackSlot() / env.BEACON_SLOTS_PER_EPOCH);
//   const epochToFetch = lastProcessedEpoch ? lastProcessedEpoch.epoch + 1 : oldestLookbackEpoch;
//   const { startSlot, endSlot } = getEpochSlots(epochToFetch);

//   logger.setContext(`epoch: ${epochToFetch}`);

//   // We need to wait for the current epoch to finish
//   if (epochToFetch >= currentEpoch) {
//     logger.info(`To soon to fetch`);
//     return;
//   }

//   // give 3 slots of the current epoch before fetching the epoch we need to fetch
//   if (currentSlot < endSlot + 3) {
//     logger.info(`To soon to fetch`);
//     return;
//   }

//   const dbEpoch = await db_getEpochByNumber(epochToFetch);
//   if (!dbEpoch) {
//     logger.info(`Epoch ${epochToFetch} not found in the database`);
//     return;
//   }

//   logger.info(`Fetching. HeadEpoch: ${epochToFetch}.`);

//   // Get validators info
//   if (!dbEpoch.validatorsInfoFetched) {
//     await fetchValidators(logger, startSlot);
//     await prisma.epoch.update({
//       where: { epoch: epochToFetch },
//       data: { validatorsInfoFetched: true },
//     });
//   }

//   // Get validators effective balances
//   // validators are rewarded by epoch. So to calculate missed rewards, we need to know the effective balances for the epoch we are fetching
//   if (!dbEpoch.validatorsBalancesFetched) {
//     await fetchValidatorsBalances(logger, startSlot);
//     await prisma.epoch.update({
//       where: { epoch: epochToFetch },
//       data: { validatorsBalancesFetched: true },
//     });
//   }

//   // Get beacon rewards for the current epoch
//   if (!dbEpoch.rewardsFetched) {
//     await fetchAttestationsRewards(logger, epochToFetch);
//     await prisma.epoch.update({
//       where: { epoch: epochToFetch },
//       data: { rewardsFetched: true },
//     });
//   }
// }

// export function scheduleFetchEpochInfo({
//   id,
//   logsEnabled,
//   intervalMs,
//   runImmediately,
//   preventOverrun,
// }: TaskOptions) {
//   const logger = createLogger(id, logsEnabled);
//   const task = new AsyncTask(`${id}_task`, () => {
//     return fetchEpochInfoTask(logger).catch((e) => logger.error('TASK-CATCH', e));
//   });
//   scheduler.addSimpleIntervalJob(
//     new SimpleIntervalJob({ milliseconds: intervalMs, runImmediately }, task, {
//       id,
//       preventOverrun,
//     }),
//   );
// }
