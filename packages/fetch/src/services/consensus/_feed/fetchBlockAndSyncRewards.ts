import ms from 'ms';

import { getPrisma } from '@/src/lib/prisma.js';
import {
  beacon_getBlockRewards,
  beacon_getSyncCommitteeRewards,
} from '@/src/services/consensus/_feed/endpoints.js';
import { SyncCommitteeRewards, type BlockRewards } from '@/src/services/consensus/types.js';
import { convertToUTC } from '@/src/utils/date/index.js';

const prisma = getPrisma();

interface SyncRewardValues {
  validatorIndex: number;
  hour: number;
  date: string;
  syncCommittee: bigint;
}

interface BlockRewardValues {
  validatorIndex: number;
  hour: number;
  date: string;
  blockReward: bigint;
}

function prepareSyncRewards(
  syncRewardsData: SyncCommitteeRewards['data'],
  hour: number,
  date: string,
): SyncRewardValues[] {
  return syncRewardsData.map((syncReward) => ({
    validatorIndex: Number(syncReward.validator_index),
    hour,
    date,
    syncCommittee: BigInt(syncReward.reward),
  }));
}

function prepareBlockRewards(
  blockRewards: 'SLOT MISSED' | BlockRewards,
  hour: number,
  date: string,
): BlockRewardValues | null {
  if (blockRewards === 'SLOT MISSED') return null;

  return {
    validatorIndex: Number(blockRewards.data.proposer_index),
    hour,
    date,
    blockReward: BigInt(blockRewards.data.total),
  };
}

/**
 * Prefetches rewards for future slots to improve performance when the bot is behind head.
 * This is particularly useful when the bot has been down and needs to catch up with rewards.
 * The requests are deduplicated by memoizee, so we can safely fire them in advance.
 */
export function prefetchBlockAndSyncRewards(slot: number, maxSlotToFetch: number) {
  for (let i = 1; i <= 5; i++) {
    const futureSlot = slot + i;
    if (futureSlot > maxSlotToFetch) break;
    beacon_getSyncCommitteeRewards(futureSlot, []);
    beacon_getBlockRewards(futureSlot);
  }
}

export const fetchBlockAndSyncRewards = async (
  slot: number,
  timestamp: number,
  syncCommitteeValidators: string[],
) => {
  const currentSlotRequests = Promise.all([
    beacon_getSyncCommitteeRewards(slot, syncCommitteeValidators),
    beacon_getBlockRewards(slot),
  ]);
  const [syncCommitteeRewards, blockRewards] = await currentSlotRequests;

  const { date, hour } = convertToUTC(new Date(timestamp * 1000));

  await prisma.$transaction(
    async (tx) => {
      // Prepare rewards data
      const syncRewards = prepareSyncRewards(
        (syncCommitteeRewards as SyncCommitteeRewards).data,
        hour,
        date,
      );
      const blockReward = prepareBlockRewards(blockRewards, hour, date);

      // Save sync committee rewards using Prisma upsert
      if (syncRewards.length > 0) {
        for (const reward of syncRewards) {
          await tx.hourlyBlockAndSyncRewards.upsert({
            where: {
              validatorIndex_date_hour: {
                validatorIndex: reward.validatorIndex,
                date: new Date(reward.date),
                hour: reward.hour,
              },
            },
            create: {
              validatorIndex: reward.validatorIndex,
              date: new Date(reward.date),
              hour: reward.hour,
              syncCommittee: reward.syncCommittee,
              blockReward: 0n,
            },
            update: {
              syncCommittee: {
                increment: reward.syncCommittee,
              },
            },
          });
        }
      }

      // Save block rewards using Prisma upsert
      if (blockReward) {
        await tx.hourlyBlockAndSyncRewards.upsert({
          where: {
            validatorIndex_date_hour: {
              validatorIndex: blockReward.validatorIndex,
              date: new Date(blockReward.date),
              hour: blockReward.hour,
            },
          },
          create: {
            validatorIndex: blockReward.validatorIndex,
            date: new Date(blockReward.date),
            hour: blockReward.hour,
            blockReward: blockReward.blockReward,
            syncCommittee: 0n,
          },
          update: {
            blockReward: {
              increment: blockReward.blockReward,
            },
          },
        });
      }

      // Update slot flags for block and sync rewards
      await tx.slot.upsert({
        where: { slot },
        update: {
          consensusRewardsFetched: true,
          syncRewardsFetched: true,
        },
        create: {
          slot,
          consensusRewardsFetched: true,
          syncRewardsFetched: true,
        },
      });
    },
    {
      timeout: ms('5m'),
    },
  );
};
