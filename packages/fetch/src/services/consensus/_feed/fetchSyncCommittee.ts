import { chainConfig } from '@/src/lib/env.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { beacon_getSyncCommittees } from '@/src/services/consensus/_feed/endpoints.js';
import { getSyncCommitteePeriodStartEpoch } from '@/src/services/consensus/utils/time.deprecated.js';

const prisma = getPrisma();

export const fetchSyncCommittees = async (epoch: number) => {
  const periodStartEpoch = getSyncCommitteePeriodStartEpoch(epoch);

  const syncCommitteeData = await beacon_getSyncCommittees(periodStartEpoch);

  await prisma.$transaction(async (tx) => {
    await tx.syncCommittee.upsert({
      where: {
        fromEpoch_toEpoch: {
          fromEpoch: periodStartEpoch,
          toEpoch: periodStartEpoch + chainConfig.beacon.epochsPerSyncCommitteePeriod - 1,
        },
      },
      create: {
        fromEpoch: periodStartEpoch,
        toEpoch: periodStartEpoch + chainConfig.beacon.epochsPerSyncCommitteePeriod - 1,
        validators: syncCommitteeData.validators,
        validatorAggregates: syncCommitteeData.validator_aggregates,
      },
      update: {},
    });

    await tx.epoch.update({
      where: { epoch: epoch },
      data: { syncCommitteesFetched: true },
    });
  });
};
