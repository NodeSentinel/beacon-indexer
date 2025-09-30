import { fromPromise } from 'xstate';

import { getPrisma } from '@/src/lib/prisma.js';
import { beacon_getValidators } from '@/src/services/consensus/_feed/endpoints.js';
import { fetchAttestationsRewards as _fetchAttestationsRewards } from '@/src/services/consensus/_feed/fetchAttestationsRewards.js';
import { fetchCommittee } from '@/src/services/consensus/_feed/fetchCommittee.js';
import { fetchSyncCommittees as _fetchSyncCommittees } from '@/src/services/consensus/_feed/fetchSyncCommittee.js';
import { fetchValidatorsBalances as _fetchValidatorsBalances } from '@/src/services/consensus/_feed/fetchValidatorsBalances.js';
import { VALIDATOR_STATUS } from '@/src/services/consensus/constants.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';

const prisma = getPrisma();

/**
 * Finds the minimum unprocessed epoch that needs processing
 * Returns a single epoch with its current state
 */
export const getMinEpochToProcess = fromPromise(
  async ({ input }: { input: { epochController: EpochController } }) => {
    return input.epochController.getMinEpochToProcess();
  },
);

export const createEpochsIfNeeded = fromPromise(
  async ({ input }: { input: { epochController: EpochController } }) => {
    await input.epochController.createEpochsIfNeeded();
  },
);

export const fetchValidatorsBalances = fromPromise(
  async ({ input }: { input: { startSlot: number } }) => {
    await _fetchValidatorsBalances(input.startSlot);
  },
);

export const fetchAttestationsRewards = fromPromise(
  async ({ input }: { input: { epoch: number } }) => {
    await _fetchAttestationsRewards(input.epoch);
  },
);

/**
 * Actor to fetch committees for an epoch
 */
export const fetchCommittees = fromPromise(async ({ input }: { input: { epoch: number } }) =>
  fetchCommittee(input.epoch),
);

/**
 * Actor to fetch sync committees for an epoch
 */
export const fetchSyncCommittees = fromPromise(async ({ input }: { input: { epoch: number } }) =>
  _fetchSyncCommittees(input.epoch),
);

/**
 * Actor to check if sync committee for a specific epoch is already fetched
 */
export const checkSyncCommitteeForEpochInDB = fromPromise(
  async ({ input }: { input: { epoch: number } }) => {
    try {
      // Check if sync committee for this epoch is already fetched
      const syncCommittee = await prisma.syncCommittee.findFirst({
        where: {
          fromEpoch: { lte: input.epoch },
          toEpoch: { gte: input.epoch },
        },
      });

      return { isFetched: !!syncCommittee };
    } catch (error) {
      console.error('Error checking sync committee status:', error);
      throw error;
    }
  },
);

/**
 * Actor to update the epoch's slotsFetched flag to true
 */
export const updateSlotsFetched = fromPromise(async ({ input }: { input: { epoch: number } }) => {
  try {
    await prisma.epoch.update({
      where: { epoch: input.epoch },
      data: { slotsFetched: true },
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating slotsFetched:', error);
    throw error;
  }
});

/**
 * Actor to update the epoch's syncCommitteesFetched flag to true
 */
export const updateSyncCommitteesFetched = fromPromise(
  async ({ input }: { input: { epoch: number } }) => {
    try {
      await prisma.epoch.update({
        where: { epoch: input.epoch },
        data: { syncCommitteesFetched: true },
      });

      return { success: true };
    } catch (error) {
      console.error('Error updating syncCommitteesFetched:', error);
      throw error;
    }
  },
);

/**
 * Unified actor to track transitioning validators
 * Fetches pending validators from DB, gets their data from beacon chain, and updates them directly
 */
export const trackingTransitioningValidators = fromPromise(async () => {
  const pendingValidators = await prisma.validator.findMany({
    where: {
      status: {
        in: [VALIDATOR_STATUS.pending_initialized, VALIDATOR_STATUS.pending_queued],
      },
    },
    select: { id: true },
  });

  if (pendingValidators.length === 0) {
    return { success: true, processedCount: 0 };
  }

  const validatorIds = pendingValidators.map((v) => String(v.id));
  const validatorsData = await beacon_getValidators('head', validatorIds, null);

  // Update validators directly in a transaction
  await prisma.$transaction(async (tx) => {
    for (const data of validatorsData) {
      const withdrawalAddress = data.validator.withdrawal_credentials.startsWith('0x')
        ? '0x' + data.validator.withdrawal_credentials.slice(-40)
        : null;

      await tx.validator.update({
        where: { id: +data.index },
        data: {
          withdrawalAddress,
          status: VALIDATOR_STATUS[data.status],
          balance: data.balance,
          effectiveBalance: data.validator.effective_balance,
        },
      });
    }
  });

  return { success: true, processedCount: validatorsData.length };
});
