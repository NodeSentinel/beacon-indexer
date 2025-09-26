import axios, { AxiosError } from 'axios';
import memoizee from 'memoizee';
import ms from 'ms';
import pRetry from 'p-retry';

import { env } from '@/src/lib/env.js';
import {
  AttestationRewards,
  BlockRewards,
  GetAttestations,
  GetCommittees,
  GetValidators,
  GetValidatorsBalances,
  SyncCommitteeRewards,
  EndpointOptions,
  GetSyncCommittees,
  Block,
} from '@/src/services/consensus/types.js';
import { instance } from '@/src/services/consensus/utils/instance.js';
import { getEpochSlots } from '@/src/services/consensus/utils/misc.js';
import { getSlotNumberFromTimestamp } from '@/src/services/consensus/utils/time.deprecated.js';

// Helper function to check for missed slot errors
function _isSlotMissedError(error: unknown): boolean {
  const axiosError = error as AxiosError<{ message: string }>;
  return (
    axiosError.response?.status === 404 &&
    axiosError.response?.data.message.includes('NOT_FOUND: beacon block')
  );
}

export function extractError(error: unknown) {
  if (error instanceof AxiosError) {
    return {
      message: error.message.slice(0, 100),
      code: error.code,
      status: error.response?.status,
    };
  }
  return error;
}

/**
 * Generic helper function for making requests with retries and multiple URLs
 *
 * This function implements a bidirectional fallback strategy:
 * 1. First attempts to make the request using the primary URL (CONSENSUS_ARCHIVE_API_URL by default)
 * 2. If the primary URL fails, automatically falls back to the secondary URL (CONSENSUS_FULL_API_URL)
 * 3. The priority can be reversed by passing { priority: 'secondary' } in options
 * 4. Each attempt includes retries using pRetry
 * 5. If both URLs fail, it will use the provided errorHandler if available
 *
 * The errorHandler is useful for handling specific error cases that should not be treated as failures.
 * For example, when a slot is missed in the blockchain, we might want to return a specific value
 * instead of throwing an error. The errorHandler receives the error and can return a value to be
 * used as the result, or undefined if the error should be propagated.
 *
 * @param callEndpoint - Function that builds the request using the provided URL
 * @param errorHandler - Optional function to handle specific error cases. If provided, it will be called
 *                      when both URLs fail. It can return a value to be used as the result, or undefined
 *                      to propagate the error.
 * @param options - Optional configuration for the request
 * @returns Promise with the response data
 */
async function makeBeaconRequest<T>(
  callEndpoint: (url: string) => Promise<T>,
  errorHandler?: (error: AxiosError<{ message: string }>) => T | undefined,
  options: EndpointOptions = {},
): Promise<T> {
  const { priority = 'primary', retries = 0 } = options;
  let lastError: unknown;

  // Get URLs based on priority
  const primaryUrl =
    priority === 'primary' ? env.CONSENSUS_ARCHIVE_API_URL : env.CONSENSUS_FULL_API_URL;
  const secondaryUrl =
    priority === 'primary' ? env.CONSENSUS_FULL_API_URL : env.CONSENSUS_ARCHIVE_API_URL;

  const minTimeout = 500;

  // Try primary URL first
  try {
    const result = await pRetry(() => callEndpoint(primaryUrl), {
      retries,
      minTimeout,
    });
    return result;
  } catch (error) {
    lastError = error;
  }

  // Always try with secondary URL if primary fails
  try {
    const result = await pRetry(() => callEndpoint(secondaryUrl), {
      retries,
      minTimeout,
    });
    return result;
  } catch (error) {
    lastError = error;
  }

  // Handle special error cases if handler provided
  if (errorHandler) {
    const handled = errorHandler(lastError as AxiosError<{ message: string }>);
    if (handled !== undefined) {
      return handled;
    }
  }

  throw extractError(lastError);
}

function isIndexerDelayed({ value, type }: { value: number; type: 'slot' | 'epoch' }) {
  let slot: number;

  if (type === 'epoch') {
    const { startSlot } = getEpochSlots(value);
    slot = startSlot;
  } else {
    slot = value;
  }

  const currentSlot = getSlotNumberFromTimestamp(Date.now());
  return currentSlot - slot > 250;
}

// Restore original endpoint functions
export async function beacon_getCommittees(
  epoch: number,
  stateId = 'head',
): Promise<GetCommittees['data']> {
  return makeBeaconRequest(
    async (url) => {
      const res = await instance.get<GetCommittees>(
        `${url}/eth/v1/beacon/states/${stateId}/committees?epoch=${epoch}`,
      );
      return res.data.data;
    },
    undefined,
    { priority: isIndexerDelayed({ value: epoch, type: 'epoch' }) ? 'primary' : 'secondary' },
  );
}

export async function beacon_getSyncCommittees(epoch: number): Promise<GetSyncCommittees['data']> {
  const { startSlot } = getEpochSlots(epoch);

  return makeBeaconRequest(
    async (url) => {
      const res = await instance.get<GetSyncCommittees>(
        `${url}/eth/v1/beacon/states/${startSlot}/sync_committees?epoch=${epoch}`,
      );
      return res.data.data;
    },
    undefined,
    { priority: 'secondary' },
  );
}

export async function beacon_blocks(slot: number): Promise<Block | 'SLOT MISSED'> {
  return makeBeaconRequest<Block | 'SLOT MISSED'>(
    async (url) => {
      const res = await instance.get<Block>(`${url}/eth/v2/beacon/blocks/${slot}`);
      return res.data;
    },
    (error: Error | AxiosError) => {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return 'SLOT MISSED';
      }
      throw error;
    },
    { priority: 'secondary' },
  );
}

export async function beacon_getAttestations(
  slot: number,
): Promise<GetAttestations['data'] | 'SLOT MISSED'> {
  type AttestationsResponse = GetAttestations['data'];

  const currentSlot = getSlotNumberFromTimestamp(Date.now());

  return makeBeaconRequest<AttestationsResponse | 'SLOT MISSED'>(
    async (url) => {
      const res = await instance.get<GetAttestations>(
        `${url}/eth/v1/beacon/blocks/${slot}/attestations`,
      );
      return res.data.data;
    },
    (error) => (_isSlotMissedError(error) ? 'SLOT MISSED' : undefined),
    { priority: currentSlot - slot > 5 ? 'primary' : 'secondary' },
  );
}

export async function beacon_getValidatorsBalances(
  stateId: string | number,
  validatorIds: string[],
): Promise<GetValidatorsBalances['data']> {
  if (validatorIds.length === 0) {
    throw new Error('No validator IDs provided');
  }

  return makeBeaconRequest(
    async (url) => {
      const res = await instance.post<GetValidatorsBalances>(
        `${url}/eth/v1/beacon/states/${stateId}/validator_balances`,
        validatorIds,
      );
      return res.data.data;
    },
    undefined,
    { priority: 'primary' },
  );
}

export async function beacon_getValidators(
  stateId: string | number,
  validatorIds: string[] | null,
  statuses: string[] | null,
): Promise<GetValidators['data']> {
  return makeBeaconRequest(
    async (url) => {
      const res = await instance.post<GetValidators>(
        `${url}/eth/v1/beacon/states/${stateId}/validators`,
        {
          ids: validatorIds,
          statuses,
        },
      );
      return res.data.data;
    },
    undefined,
    { priority: 'primary' },
  );
}

export async function beacon_getAttestationRewards(
  epoch: number,
  validatorIds: number[],
): Promise<AttestationRewards> {
  return makeBeaconRequest(
    async (url) => {
      const res = await instance.post<AttestationRewards>(
        `${url}/eth/v1/beacon/rewards/attestations/${epoch}`,
        validatorIds.map((id) => id.toString()),
      );
      return res.data;
    },
    undefined,
    { priority: 'primary' },
  );
}

export const beacon_getBlockRewards = memoizee(
  async function getBlockRewards(slot: number) {
    return makeBeaconRequest<BlockRewards | 'SLOT MISSED'>(
      async (url) => {
        const res = await instance.get<BlockRewards>(`${url}/eth/v1/beacon/rewards/blocks/${slot}`);
        return res.data;
      },
      (error) => {
        if (_isSlotMissedError(error)) {
          return 'SLOT MISSED';
        }
        return undefined;
      },
      { priority: isIndexerDelayed({ value: slot, type: 'slot' }) ? 'primary' : 'secondary' },
    );
  },
  {
    promise: true,
    maxAge: ms('10m'),
    primitive: true,
  },
);

export const beacon_getSyncCommitteeRewards = memoizee(
  async function getSyncCommitteeRewards(slot: number, validatorIds: string[]) {
    return makeBeaconRequest<SyncCommitteeRewards | 'SLOT MISSED'>(
      async (url) => {
        const res = await instance.post<SyncCommitteeRewards>(
          `${url}/eth/v1/beacon/rewards/sync_committee/${slot}`,
          validatorIds,
        );
        return res.data;
      },
      (error) => {
        if (_isSlotMissedError(error)) {
          return 'SLOT MISSED';
        }
        return undefined;
      },
      { priority: isIndexerDelayed({ value: slot, type: 'slot' }) ? 'primary' : 'secondary' },
    );
  },
  {
    promise: true,
    maxAge: ms('10m'),
    primitive: true,
  },
);
