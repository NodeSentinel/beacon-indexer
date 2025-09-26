import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';

import createLogger, { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { scheduler } from '@/src/lib/scheduler.js';
import { TaskOptions } from '@/src/scheduler/tasks/types.js';

const prisma = getPrisma();

async function updateWeeklyRewardsTask(logger: CustomLogger) {
  try {
    logger.info('Starting weekly rewards update');

    // Update weekly CL and EL rewards for all validators in ValidatorsStats
    // Using INSERT ... ON CONFLICT ... DO UPDATE to handle both existing and new records
    await prisma.$executeRaw`
      WITH 
      
      -------------------------------------
      -- Get only validators that users are monitoring
      -------------------------------------
      
      user_validators AS (
        SELECT DISTINCT "B" as validator_id
        FROM "_UserToValidator"
      ),
      
      -------------------------------------
      -- Calculate weekly CL rewards from DailyValidatorStats (attestation rewards only)
      -------------------------------------

      cl_attestation_rewards AS (
        SELECT 
          dvs."validatorIndex",
          COALESCE(SUM(CAST(dvs.head AS BIGINT)), 0) + 
          COALESCE(SUM(CAST(dvs.target AS BIGINT)), 0) + 
          COALESCE(SUM(CAST(dvs.source AS BIGINT)), 0) + 
          COALESCE(SUM(CAST(dvs.inactivity AS BIGINT)), 0) as weekly_cl_rewards
        FROM user_validators uv
        INNER JOIN "DailyValidatorStats" dvs ON dvs."validatorIndex" = uv.validator_id
        WHERE dvs.date >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY dvs."validatorIndex"
      ),

      -------------------------------------
      -- Calculate weekly CL rewards from DailyValidatorStats (block and sync rewards)
      -------------------------------------

      cl_block_and_sync_rewards AS (
        SELECT 
          dvs."validatorIndex",
          COALESCE(SUM(CAST(dvs."syncCommittee" AS BIGINT)), 0) +
          COALESCE(SUM(CAST(dvs."blockReward" AS BIGINT)), 0) as weekly_cl_rewards
        FROM user_validators uv
        INNER JOIN "DailyValidatorStats" dvs ON dvs."validatorIndex" = uv.validator_id
        WHERE dvs.date >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY dvs."validatorIndex"
      ),

      -------------------------------------
      -- Combine CL rewards from both attestation and block/sync sources
      -------------------------------------

      cl_rewards_combined AS (
        SELECT 
          COALESCE(att."validatorIndex", bas."validatorIndex") as "validatorIndex",
          COALESCE(att.weekly_cl_rewards, 0) + COALESCE(bas.weekly_cl_rewards, 0) as weekly_cl_rewards
        FROM cl_attestation_rewards att
        FULL OUTER JOIN cl_block_and_sync_rewards bas ON att."validatorIndex" = bas."validatorIndex"
      ),

      -------------------------------------
      -- Calculate weekly EL rewards only for monitored validators
      -------------------------------------

      el_rewards AS (
        -- Calculate EL rewards from ExecutionRewards for fee reward addresses for the last 7 days
        SELECT 
          uv."B" as validator_id,
          COALESCE(SUM(CAST(er.amount AS BIGINT)), 0) as weekly_el_rewards
        FROM "_UserToValidator" uv
        JOIN "_FeeRewardAddressToUser" fra ON fra."B" = uv."A"
        JOIN "ExecutionRewards" er ON LOWER(er.address) = LOWER(fra."A")
        WHERE er.timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY uv."B"
      )

      -------------------------------------
      -- Insert or update ValidatorsStats table with weekly rewards
      -------------------------------------
      
      INSERT INTO "ValidatorsStats" ("validatorId", "weeklyCLRewards", "weeklyELRewards", "timestamp")
      SELECT 
        cl."validatorIndex",
        cl.weekly_cl_rewards,
        COALESCE(el.weekly_el_rewards, 0),
        NOW()
      FROM cl_rewards_combined cl
      LEFT JOIN el_rewards el ON el.validator_id = cl."validatorIndex"
      ON CONFLICT ("validatorId") 
      DO UPDATE SET
        "weeklyCLRewards" = EXCLUDED."weeklyCLRewards",
        "weeklyELRewards" = EXCLUDED."weeklyELRewards",
        "timestamp" = EXCLUDED."timestamp"
    `;

    logger.info('Weekly rewards updated successfully');
  } catch (error) {
    logger.error('Error updating weekly rewards:', error);
    throw error;
  }
}

export function schedulerUpdateWeeklyRewards_validatorsStats({
  id,
  logsEnabled,
  intervalMs,
  runImmediately,
  preventOverrun,
}: TaskOptions) {
  const logger = createLogger(id, logsEnabled);

  const task = new AsyncTask(`${id}_task`, () =>
    updateWeeklyRewardsTask(logger).catch((e) => {
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
