import axios, { AxiosError, AxiosInstance } from 'axios';
import memoizee from 'memoizee';
import ms from 'ms';

import { logRequest, logResponse } from '@/src/lib/httpPino.js';
import {
  AttestationRewards,
  BlockRewards,
  GetAttestations,
  GetCommittees,
  GetValidators,
  GetValidatorsBalances,
  SyncCommitteeRewards,
  GetSyncCommittees,
  Block,
} from '@/src/services/consensus/types.js';
import { getEpochSlots } from '@/src/services/consensus/utils/misc.js';
import { ReliableRequestClient } from '@/src/services/consensus/utils/reliableRequestClient.js';
import { getSlotNumberFromTimestamp } from '@/src/services/consensus/utils/time.deprecated.js';

/**
 * Configuration interface for BeaconClient
 */
export interface BeaconClientConfig {
  fullNodeUrl: string;
  fullNodeConcurrency: number;
  fullNodeRetries: number;
  archiveNodeUrl: string;
  archiveNodeConcurrency: number;
  archiveNodeRetries: number;
  baseDelay: number;
  slotStartIndexing: number;
}

/**
 * Enhanced BeaconClient class that manages all beacon chain endpoints
 * with concurrency control, exponential backoff, and fallback strategies
 */
export class BeaconClient extends ReliableRequestClient {
  private readonly axiosInstance: AxiosInstance;
  public readonly slotStartIndexing: number;

  constructor(config: BeaconClientConfig) {
    super({
      fullNodeUrl: config.fullNodeUrl,
      fullNodeConcurrency: config.fullNodeConcurrency,
      fullNodeRetries: config.fullNodeRetries,
      archiveNodeUrl: config.archiveNodeUrl,
      archiveNodeConcurrency: config.archiveNodeConcurrency,
      archiveNodeRetries: config.archiveNodeRetries,
      baseDelay: config.baseDelay,
    });

    this.slotStartIndexing = config.slotStartIndexing;
    this.axiosInstance = axios.create();
    this.axiosInstance.interceptors.request.use(logRequest);
    this.axiosInstance.interceptors.response.use(logResponse);
  }

  /**
   * Handle slot-related errors, return handled value or throw if cannot handle
   */
  private handleSlotError(error: unknown): 'SLOT MISSED' | undefined {
    const axiosError = error as AxiosError<{ message: string }>;
    if (
      axiosError.response?.status === 404 &&
      axiosError.response?.data.message.includes('NOT_FOUND: beacon block')
    ) {
      return 'SLOT MISSED';
    }
    // If we can't handle this error, throw it to trigger retry
    throw error;
  }

  /**
   * Check if indexer is delayed for priority selection
   */
  private isIndexerDelayed({ value, type }: { value: number; type: 'slot' | 'epoch' }): boolean {
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

  /**
   * Get committees for a specific epoch
   */
  async getCommittees(epoch: number, stateId = 'head'): Promise<GetCommittees['data']> {
    return this.makeReliableRequest(
      async (url) => {
        const res = await this.axiosInstance.get<GetCommittees>(
          `${url}/eth/v1/beacon/states/${stateId}/committees?epoch=${epoch}`,
        );
        return res.data.data;
      },
      this.isIndexerDelayed({ value: epoch, type: 'epoch' }) ? 'full' : 'archive',
    );
  }

  /**
   * Get sync committees for a specific epoch
   */
  async getSyncCommittees(epoch: number): Promise<GetSyncCommittees['data']> {
    const { startSlot } = getEpochSlots(epoch);

    return this.makeReliableRequest(async (url) => {
      const res = await this.axiosInstance.get<GetSyncCommittees>(
        `${url}/eth/v1/beacon/states/${startSlot}/sync_committees?epoch=${epoch}`,
      );
      return res.data.data;
    }, 'archive');
  }

  /**
   * Get block data for a specific slot
   */
  async getBlock(slot: number): Promise<Block | 'SLOT MISSED'> {
    return this.makeReliableRequest<Block | 'SLOT MISSED'>(
      async (url) => {
        const res = await this.axiosInstance.get<Block>(`${url}/eth/v2/beacon/blocks/${slot}`);
        return res.data;
      },
      'archive',
      (error: Error | AxiosError) => {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          return 'SLOT MISSED';
        }
        throw error;
      },
    );
  }

  /**
   * Get attestations for a specific slot
   */
  async getAttestations(slot: number): Promise<GetAttestations['data'] | 'SLOT MISSED'> {
    type AttestationsResponse = GetAttestations['data'];

    const currentSlot = getSlotNumberFromTimestamp(Date.now());

    return this.makeReliableRequest<AttestationsResponse | 'SLOT MISSED'>(
      async (url) => {
        const res = await this.axiosInstance.get<GetAttestations>(
          `${url}/eth/v1/beacon/blocks/${slot}/attestations`,
        );
        return res.data.data;
      },
      currentSlot - slot > 5 ? 'full' : 'archive',
      (error) => this.handleSlotError(error),
    );
  }

  /**
   * Get validator balances for specific validator IDs
   */
  async getValidatorsBalances(
    stateId: string | number,
    validatorIds: string[],
  ): Promise<GetValidatorsBalances['data']> {
    if (validatorIds.length === 0) {
      throw new Error('No validator IDs provided');
    }

    return this.makeReliableRequest(async (url) => {
      const res = await this.axiosInstance.post<GetValidatorsBalances>(
        `${url}/eth/v1/beacon/states/${stateId}/validator_balances`,
        validatorIds,
      );
      return res.data.data;
    }, 'full');
  }

  /**
   * Get validators information with optional filtering
   */
  async getValidators(
    stateId: string | number,
    validatorIds: string[] | null,
    statuses: string[] | null,
  ): Promise<GetValidators['data']> {
    return this.makeReliableRequest(async (url) => {
      const res = await this.axiosInstance.post<GetValidators>(
        `${url}/eth/v1/beacon/states/${stateId}/validators`,
        {
          ids: validatorIds,
          statuses,
        },
      );
      return res.data.data;
    }, 'archive');
  }

  /**
   * Get attestation rewards for specific validators in an epoch
   */
  async getAttestationRewards(epoch: number, validatorIds: number[]): Promise<AttestationRewards> {
    return this.makeReliableRequest(async (url) => {
      const res = await this.axiosInstance.post<AttestationRewards>(
        `${url}/eth/v1/beacon/rewards/attestations/${epoch}`,
        validatorIds.map((id) => id.toString()),
      );
      return res.data;
    }, 'full');
  }

  /**
   * Get block rewards for a specific slot (memoized)
   */
  getBlockRewards = memoizee(
    async (slot: number): Promise<BlockRewards | 'SLOT MISSED'> => {
      return this.makeReliableRequest<BlockRewards | 'SLOT MISSED'>(
        async (url) => {
          const res = await this.axiosInstance.get<BlockRewards>(
            `${url}/eth/v1/beacon/rewards/blocks/${slot}`,
          );
          return res.data;
        },
        this.isIndexerDelayed({ value: slot, type: 'slot' }) ? 'full' : 'archive',
        (error) => this.handleSlotError(error),
      );
    },
    {
      promise: true,
      maxAge: ms('10m'),
      primitive: true,
    },
  );

  /**
   * Get sync committee rewards for specific validators in a slot (memoized)
   */
  getSyncCommitteeRewards = memoizee(
    async (slot: number, validatorIds: string[]): Promise<SyncCommitteeRewards | 'SLOT MISSED'> => {
      return this.makeReliableRequest<SyncCommitteeRewards | 'SLOT MISSED'>(
        async (url) => {
          const res = await this.axiosInstance.post<SyncCommitteeRewards>(
            `${url}/eth/v1/beacon/rewards/sync_committee/${slot}`,
            validatorIds,
          );
          return res.data;
        },
        this.isIndexerDelayed({ value: slot, type: 'slot' }) ? 'full' : 'archive',
        (error) => this.handleSlotError(error),
      );
    },
    {
      promise: true,
      maxAge: ms('10m'),
      primitive: true,
    },
  );
}
