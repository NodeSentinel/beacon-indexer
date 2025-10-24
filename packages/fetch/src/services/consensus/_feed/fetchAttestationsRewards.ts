import { Prisma } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import ms from 'ms';

import { getPrisma } from '@/src/lib/prisma.js';
import { beacon_getAttestationRewards } from '@/src/services/consensus/_feed/endpoints.js';
import { AttestationRewards } from '@/src/services/consensus/types.js';
import { getTimestampFromEpochNumber } from '@/src/services/consensus/utils/time.deprecated.js';
import { convertToUTC } from '@/src/utils/date/index.js';
import { db_getAttestingValidatorsIds, db_getValidatorsBalances } from '@/src/utils/db.js';

const prisma = getPrisma();

// Create a lookup map for O(1) access to ideal rewards
function createIdealRewardsLookup(
  idealRewards: AttestationRewards['data']['ideal_rewards'],
): Map<string, AttestationRewards['data']['ideal_rewards'][number]> {
  const lookup = new Map<string, AttestationRewards['data']['ideal_rewards'][number]>();

  // Create map with effective_balance as key (already rounded in the response)
  for (const reward of idealRewards) {
    const effectiveBalance = reward.effective_balance;
    lookup.set(effectiveBalance, reward);
  }

  return lookup;
}

// Find the appropriate ideal rewards based on effective balance - O(1) lookup
function findIdealRewardsForBalance(
  validatorBalance: string,
  idealRewardsLookup: Map<string, AttestationRewards['data']['ideal_rewards'][number]>,
): AttestationRewards['data']['ideal_rewards'][number] | null {
  const _validatorBalance = BigInt(validatorBalance);

  // Round down validator balance
  const roundedBalance = (_validatorBalance / 1000000000n) * 1000000000n;

  return idealRewardsLookup.get(roundedBalance.toString()) || null;
}

function formatValidatorReward(
  validatorInfo: AttestationRewards['data']['total_rewards'][number],
  validatorBalance: string,
  idealRewardsLookup: Map<string, AttestationRewards['data']['ideal_rewards'][number]>,
  date: string,
  hour: number,
): string {
  if (validatorBalance === '0') {
    return `(${Number(validatorInfo.validator_index)}, '${date}', ${hour}, 0, 0, 0, 0, 0, 0, 0, 0)`;
  }

  const head = BigInt(validatorInfo.head || '0');
  const target = BigInt(validatorInfo.target || '0');
  const source = BigInt(validatorInfo.source || '0');
  const inactivity = BigInt(validatorInfo.inactivity || '0');

  // Find ideal rewards for this validator's balance - O(1) lookup
  const idealReward = findIdealRewardsForBalance(validatorBalance, idealRewardsLookup);

  let missedHead = 0n;
  let missedTarget = 0n;
  let missedSource = 0n;
  let missedInactivity = 0n;

  if (idealReward) {
    // Calculate missed rewards (ideal - received)
    missedHead = BigInt(idealReward.head || '0') - head;
    missedTarget = BigInt(idealReward.target || '0') - target;
    missedSource = BigInt(idealReward.source || '0') - source;
    missedInactivity = BigInt(idealReward.inactivity || '0') - inactivity;
  }

  return `(${Number(validatorInfo.validator_index)}, '${date}', ${hour}, ${head}, ${target}, ${source}, ${inactivity}, ${missedHead}, ${missedTarget}, ${missedSource}, ${missedInactivity})`;
}

async function truncateTempTable(): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE "EpochRewardsTemp"`;
}

async function insertBatchIntoTempTable(
  rewards: AttestationRewards['data']['total_rewards'],
  validatorsBalancesMap: Map<string, string>,
  idealRewardsLookup: Map<string, AttestationRewards['data']['ideal_rewards'][number]>,
  date: string,
  hour: number,
): Promise<void> {
  const values = rewards
    .map((validatorInfo) => {
      const balance = validatorsBalancesMap.get(validatorInfo.validator_index) || '0';
      return formatValidatorReward(validatorInfo, balance, idealRewardsLookup, date, hour);
    })
    .join(',');

  await prisma.$executeRaw`
    INSERT INTO "EpochRewardsTemp" 
      ("validatorIndex", "date", "hour", "head", "target", "source", "inactivity", "missedHead", "missedTarget", "missedSource", "missedInactivity")
    VALUES ${Prisma.raw(values)}
  `;
}

async function processTmpTableAndUpdateEpoch(
  tx: Prisma.TransactionClient,
  epoch: number,
): Promise<void> {
  // Merge data from temporary table to main table
  await tx.$executeRaw`
    INSERT INTO "HourlyValidatorStats" 
      ("validatorIndex", "date", "hour", "head", "target", "source", "inactivity", "missedHead", "missedTarget", "missedSource", "missedInactivity")
    SELECT 
      "validatorIndex", "date", "hour", "head", "target", "source", "inactivity", "missedHead", "missedTarget", "missedSource", "missedInactivity"
    FROM "EpochRewardsTemp"
    ON CONFLICT ("validatorIndex", "date", "hour") DO UPDATE SET
      "head" = COALESCE("HourlyValidatorStats"."head", 0) + COALESCE(EXCLUDED."head", 0),
      "target" = COALESCE("HourlyValidatorStats"."target", 0) + COALESCE(EXCLUDED."target", 0),
      "source" = COALESCE("HourlyValidatorStats"."source", 0) + COALESCE(EXCLUDED."source", 0),
      "inactivity" = COALESCE("HourlyValidatorStats"."inactivity", 0) + COALESCE(EXCLUDED."inactivity", 0),
      "missedHead" = COALESCE("HourlyValidatorStats"."missedHead", 0) + COALESCE(EXCLUDED."missedHead", 0),
      "missedTarget" = COALESCE("HourlyValidatorStats"."missedTarget", 0) + COALESCE(EXCLUDED."missedTarget", 0),
      "missedSource" = COALESCE("HourlyValidatorStats"."missedSource", 0) + COALESCE(EXCLUDED."missedSource", 0),
      "missedInactivity" = COALESCE("HourlyValidatorStats"."missedInactivity", 0) + COALESCE(EXCLUDED."missedInactivity", 0)
  `;

  // Update epoch status
  await tx.epoch.update({
    where: { epoch },
    data: { rewardsFetched: true },
  });
}

export async function fetchAttestationsRewards(epoch: number) {
  try {
    const epochTimestamp = getTimestampFromEpochNumber(epoch);
    const { date, hour } = convertToUTC(epochTimestamp);

    // Truncate temp table
    await truncateTempTable();

    // Get all validator in non final states fetch info
    const allValidatorIds = await db_getAttestingValidatorsIds();
    let idealRewardsLookup: Map<
      string,
      AttestationRewards['data']['ideal_rewards'][number]
    > | null = null;

    // split all validators in batches
    const validatorBatches = chunk(allValidatorIds, 1000000);
    allValidatorIds.length = 0;

    // Fetch rewards in batches and save in a temp table
    for (const batch of validatorBatches) {
      // Get effective balances for the validators in the batch
      const validatorsBalances = await db_getValidatorsBalances(batch);
      const validatorsBalancesMap = new Map(
        validatorsBalances.map((balance) => [
          balance.id.toString(),
          balance.balance?.toString() || '0',
        ]),
      );
      //validatorsBalances.length = 0;

      // fetch the beacon chain to get the rewards for this batch
      const epochRewards = await beacon_getAttestationRewards(epoch, batch);

      // Create ideal-rewards lookup if this is the first batch
      // ideal-rewards is for the epoch, so we only need to do it once
      if (!idealRewardsLookup) {
        idealRewardsLookup = createIdealRewardsLookup(epochRewards.data.ideal_rewards);
      }

      // Save rewards in a temp table
      const rewardBatches = chunk(epochRewards.data.total_rewards, 12_000);
      for (const rewardBatch of rewardBatches) {
        await insertBatchIntoTempTable(
          rewardBatch,
          validatorsBalancesMap,
          idealRewardsLookup!,
          date,
          hour,
        );
      }
      batch.length = 0;
    }

    // process tmb results and combine them in the main table
    // also mark the epoch as rewards fetched
    await prisma.$transaction(
      async (tx) => {
        await processTmpTableAndUpdateEpoch(tx, epoch);
      },
      {
        timeout: ms('3m'),
      },
    );
  } catch (error) {
    console.error('Error processing rewards:', error);
    throw error;
  }
}
