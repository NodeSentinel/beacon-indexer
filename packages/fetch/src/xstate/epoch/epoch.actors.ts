import { fromPromise } from 'xstate';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';

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

export const markEpochAsProcessed = fromPromise(
  async ({
    input,
  }: {
    input: { epochController: EpochController; epoch: number; machineId: string };
  }) => {
    await input.epochController.markEpochAsProcessed(input.epoch);
    return { success: true, machineId: input.machineId };
  },
);

export const fetchValidatorsBalances = fromPromise(
  async ({ input }: { input: { epochController: EpochController; startSlot: number } }) =>
    input.epochController.fetchValidatorsBalances(input.startSlot),
);

export const fetchAttestationsRewards = fromPromise(
  async ({ input }: { input: { epochController: EpochController; epoch: number } }) =>
    input.epochController.fetchAttestationRewards(input.epoch),
);

/**
 * Actor to fetch committees for an epoch
 */
export const fetchCommittees = fromPromise(
  async ({ input }: { input: { epochController: EpochController; epoch: number } }) => {
    await input.epochController.fetchCommittees(input.epoch);
  },
);

/**
 * Actor to fetch sync committees for an epoch
 */
export const fetchSyncCommittees = fromPromise(
  async ({ input }: { input: { epochController: EpochController; epoch: number } }) => {
    await input.epochController.fetchSyncCommittees(input.epoch);
  },
);

/**
 * Actor to check if sync committee for a specific epoch is already fetched
 */
export const checkSyncCommitteeForEpochInDB = fromPromise(
  async ({ input }: { input: { epochController: EpochController; epoch: number } }) => {
    return input.epochController.checkSyncCommitteeForEpoch(input.epoch);
  },
);

/**
 * Actor to update the epoch's slotsFetched flag to true
 */
export const updateSlotsFetched = fromPromise(
  async ({ input }: { input: { epochController: EpochController; epoch: number } }) => {
    return input.epochController.updateSlotsFetched(input.epoch);
  },
);

/**
 * Actor to update the epoch's syncCommitteesFetched flag to true
 */
export const updateSyncCommitteesFetched = fromPromise(
  async ({ input }: { input: { epochController: EpochController; epoch: number } }) => {
    return input.epochController.updateSyncCommitteesFetched(input.epoch);
  },
);

/**
 * Unified actor to track transitioning validators
 * Fetches pending validators from DB, gets their data from beacon chain, and updates them directly
 */
export const trackingTransitioningValidators = fromPromise(
  async ({ input }: { input: { epochController: EpochController } }) => {
    return input.epochController.trackTransitioningValidators();
  },
);
