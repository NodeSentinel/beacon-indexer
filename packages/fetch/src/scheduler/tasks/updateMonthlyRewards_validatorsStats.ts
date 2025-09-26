import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler';

import createLogger, { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { scheduler } from '@/src/lib/scheduler.js';
import { TaskOptions } from '@/src/scheduler/tasks/types.js';

const prisma = getPrisma();

async function updateMonthlyRewardsTask(logger: CustomLogger) {
  try {
    logger.info('Starting monthly rewards update');

    // Update monthly CL and EL rewards for all validators in ValidatorsStats
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
      -- Calculate monthly CL rewards from DailyValidatorStats (attestation rewards only)
      -------------------------------------

      cl_attestation_rewards AS (
        SELECT 
          dvs."validatorIndex",
          COALESCE(SUM(CAST(dvs.head AS BIGINT)), 0) + 
          COALESCE(SUM(CAST(dvs.target AS BIGINT)), 0) + 
          COALESCE(SUM(CAST(dvs.source AS BIGINT)), 0) + 
          COALESCE(SUM(CAST(dvs.inactivity AS BIGINT)), 0) as monthly_cl_rewards
        FROM user_validators uv
        INNER JOIN "DailyValidatorStats" dvs ON dvs."validatorIndex" = uv.validator_id
        WHERE dvs.date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY dvs."validatorIndex"
      ),

      -------------------------------------
      -- Calculate monthly CL rewards from DailyValidatorStats (block and sync rewards)
      -------------------------------------

      cl_block_and_sync_rewards AS (
        SELECT 
          dvs."validatorIndex",
          COALESCE(SUM(CAST(dvs."syncCommittee" AS BIGINT)), 0) +
          COALESCE(SUM(CAST(dvs."blockReward" AS BIGINT)), 0) as monthly_cl_rewards
        FROM user_validators uv
        INNER JOIN "DailyValidatorStats" dvs ON dvs."validatorIndex" = uv.validator_id
        WHERE dvs.date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY dvs."validatorIndex"
      ),

      -------------------------------------
      -- Combine CL rewards from both attestation and block/sync sources
      -------------------------------------

      cl_rewards_combined AS (
        SELECT 
          COALESCE(att."validatorIndex", bas."validatorIndex") as "validatorIndex",
          COALESCE(att.monthly_cl_rewards, 0) + COALESCE(bas.monthly_cl_rewards, 0) as monthly_cl_rewards
        FROM cl_attestation_rewards att
        FULL OUTER JOIN cl_block_and_sync_rewards bas ON att."validatorIndex" = bas."validatorIndex"
      ),

      -------------------------------------
      -- Calculate monthly EL rewards only for monitored validators
      -------------------------------------

      el_rewards AS (
        -- Calculate EL rewards from ExecutionRewards for fee reward addresses for the last 30 days
        SELECT 
          uv."B" as validator_id,
          COALESCE(SUM(CAST(er.amount AS BIGINT)), 0) as monthly_el_rewards
        FROM "_UserToValidator" uv
        JOIN "_FeeRewardAddressToUser" fra ON fra."B" = uv."A"
        JOIN "ExecutionRewards" er ON LOWER(er.address) = LOWER(fra."A")
        WHERE er.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY uv."B"
      )

      -------------------------------------
      -- Insert or update ValidatorsStats table with monthly rewards
      -------------------------------------
      
      INSERT INTO "ValidatorsStats" ("validatorId", "monthlyCLRewards", "monthlyELRewards", "timestamp")
      SELECT 
        cl."validatorIndex",
        cl.monthly_cl_rewards,
        COALESCE(el.monthly_el_rewards, 0),
        NOW()
      FROM cl_rewards_combined cl
      LEFT JOIN el_rewards el ON el.validator_id = cl."validatorIndex"
      ON CONFLICT ("validatorId") 
      DO UPDATE SET
        "monthlyCLRewards" = EXCLUDED."monthlyCLRewards",
        "monthlyELRewards" = EXCLUDED."monthlyELRewards",
        "timestamp" = EXCLUDED."timestamp"
    `;

    logger.info('Monthly rewards updated successfully');
  } catch (error) {
    logger.error('Error updating monthly rewards:', error);
    throw error;
  }
}

export function schedulerUpdateMonthlyRewards_validatorsStats({
  id,
  logsEnabled,
  intervalMs,
  runImmediately,
  preventOverrun,
}: TaskOptions) {
  const logger = createLogger(id, logsEnabled);

  const task = new AsyncTask(`${id}_task`, () =>
    updateMonthlyRewardsTask(logger).catch((e) => {
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
