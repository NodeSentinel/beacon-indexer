import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { LRUCache } from 'lru-cache';
import ms from 'ms';

import { logError, logRequest, logResponse } from '@/src/lib/httpPino.js';
import {
  AttestationRewards,
  Block,
  BlockRewards,
  GetAttestations,
  GetCommittees,
  GetSyncCommittees,
  GetValidators,
  GetValidatorsBalances,
  SyncCommitteeRewards,
  ValidatorProposerDuties,
} from '@/src/services/consensus/types.js';
import { getEpochSlots } from '@/src/services/consensus/utils/misc.js';
import { ReliableRequestClient } from '@/src/services/consensus/utils/reliableRequestClient.js';
import { getSlotNumberFromTimestamp } from '@/src/services/consensus/utils/time.deprecated.js';

// Extend Axios config to include metadata for nodeType
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  metadata?: {
    startTime?: number;
    nodeType?: 'full' | 'archive';
  };
}

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
  slotsPerEpoch: number;
  archiveNodeToken?: { key: string; value: string };
}

/**
 * Enhanced BeaconClient class that manages all beacon chain endpoints
 * with concurrency control, exponential backoff, and fallback strategies
 */
export class BeaconClient extends ReliableRequestClient {
  private readonly axiosInstance: AxiosInstance;
  public readonly slotStartIndexing: number;
  public readonly slotsPerEpoch: number;
  private readonly archiveNodeToken?: { key: string; value: string };

  /**
   * Caches block rewards fetched in advance for delayed slots, with a fallback to handle missed slots.
   * 'SLOT MISSED' is used to indicate that the slot was missed, allowing the caller to handle it accordingly.
   */
  private readonly blockRewardsCache = new LRUCache<number, BlockRewards | 'SLOT MISSED'>({
    max: 4,
    ttl: ms('5m'),
    ttlAutopurge: true,
    fetchMethod: (slot) => this.fetchBlockRewardsUncached(slot),
  });

  /**
   * Caches sync committee rewards fetched in advance.
   */
  private readonly syncCommitteeRewardsCache = new LRUCache<
    string,
    SyncCommitteeRewards,
    { ignoreErrors?: boolean } | undefined
  >({
    max: 4,
    ttl: ms('5m'),
    ttlAutopurge: true,
    fetchMethod: async (key, _staleValue, { context }) => {
      const [slot, validatorIndexes] = this.parseSyncCommitteeRewardsCacheKey(key);
      // null marks ignored prefetch errors as handled so makeReliableRequest does not retry.
      const handleError = context?.ignoreErrors ? () => null : undefined;

      const rewards = await this.makeReliableRequest<SyncCommitteeRewards | null>(
        async (url) => {
          const res = await this.axiosInstance.post<SyncCommitteeRewards>(
            `${url}/eth/v1/beacon/rewards/sync_committee/${slot}`,
            validatorIndexes,
            {
              timeout: ms('1m'),
            },
          );
          return res.data;
        },
        this.isIndexerDelayed({ value: slot, type: 'slot' }) ? 'archive' : 'full',
        handleError,
      );

      // undefined prevents lru-cache from storing failed prefetch results.
      return rewards ?? undefined;
    },
  });

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
    this.slotsPerEpoch = config.slotsPerEpoch;
    this.archiveNodeToken = config.archiveNodeToken;
    this.axiosInstance = axios.create();

    // Add header interceptor for archive node requests and nodeType metadata
    this.axiosInstance.interceptors.request.use((config) => {
      logRequest(config);

      // Determine node type based on URL
      const url = config.url || '';
      let nodeType: 'full' | 'archive';
      if (url.startsWith(this.archiveNodeUrl)) {
        nodeType = 'archive';
      } else if (url.startsWith(this.fullNodeUrl)) {
        nodeType = 'full';
      } else {
        throw new Error(`Unable to determine node type for URL: ${url}`);
      }

      // Add nodeType to metadata for logging
      const extendedConfig = config as ExtendedAxiosRequestConfig;
      extendedConfig.metadata = extendedConfig.metadata || {};
      extendedConfig.metadata.nodeType = nodeType;

      // Add token header only if token is provided and this is an archive node request
      if (this.archiveNodeToken && nodeType === 'archive') {
        config.headers[this.archiveNodeToken.key] = this.archiveNodeToken.value;
      }

      return config;
    });

    this.axiosInstance.interceptors.response.use(logResponse, logError);
  }

  /**
   * Handle slot-related errors, return handled value or throw if cannot handle
   */
  // TODO: change this logic, we should relay on 404 vs other errors codes.
  // 404 should retry if we are close to the head.
  private handleSlotError(error: unknown): 'SLOT MISSED' | undefined {
    const axiosError = error as AxiosError<{ message: string }>;
    if (axiosError.response?.status === 404) {
      return 'SLOT MISSED';
    }
    // If we can't handle this error, throw it to trigger retry
    throw error;
  }

  /**
   * Check if indexer is delayed for priority selection
   */
  private isIndexerDelayed({ type, value }: { value: number; type: 'slot' | 'epoch' }): boolean {
    let slot: number;

    if (type === 'epoch') {
      const { startSlot } = getEpochSlots(value);
      slot = startSlot;
    } else {
      slot = value;
    }

    const currentSlot = getSlotNumberFromTimestamp(Date.now());
    return currentSlot - slot > this.slotsPerEpoch * 2;
  }

  /**
   * Build a stable cache key for sync committee rewards requests.
   */
  private getSyncCommitteeRewardsCacheKey(slot: number, validatorIndexes: string[]): string {
    return `${slot}:${[...validatorIndexes].sort().join(',')}`;
  }

  /**
   * Parse a sync committee rewards cache key into request inputs.
   */
  private parseSyncCommitteeRewardsCacheKey(key: string): [number, string[]] {
    const separatorIndex = key.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error(`Invalid sync committee rewards cache key: ${key}`);
    }

    const slot = Number(key.slice(0, separatorIndex));
    const validatorIndexesString = key.slice(separatorIndex + 1);
    const validatorIndexes = validatorIndexesString ? validatorIndexesString.split(',') : [];

    return [slot, validatorIndexes];
  }

  /**
   * Get committees for a specific epoch
   */
  async getCommittees(
    epoch: number,
    stateId: string | number = 'head',
  ): Promise<GetCommittees['data']> {
    return this.makeReliableRequest(
      async (url) => {
        const res = await this.axiosInstance.get<GetCommittees>(
          `${url}/eth/v1/beacon/states/${stateId}/committees?epoch=${epoch}`,
          {
            timeout: ms('45s'),
          },
        );
        return res.data.data;
      },
      this.isIndexerDelayed({ value: epoch, type: 'epoch' }) ? 'archive' : 'full',
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
        const res = await this.axiosInstance.get<Block>(`${url}/eth/v2/beacon/blocks/${slot}`, {
          timeout: ms('10s'),
        });
        return res.data;
      },
      'archive',
      (error: AxiosError) => {
        // TODO: Check for slot missed using message.
        // compare a real slot missed vs one from the future
        // compare also both Beacon APIs Archive and full
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
   * Get validator balances for specific validator indices
   */
  async getValidatorsBalances(
    stateId: string | number,
    validatorIndexes: string[],
  ): Promise<GetValidatorsBalances['data']> {
    if (validatorIndexes.length === 0) {
      throw new Error('No validator indices provided');
    }

    return this.makeReliableRequest(async (url) => {
      const res = await this.axiosInstance.post<GetValidatorsBalances>(
        `${url}/eth/v1/beacon/states/${stateId}/validator_balances`,
        validatorIndexes,
        {
          // Timeout is 20% above the largest observed slow validator state response.
          timeout: ms('15s'),
        },
      );
      return res.data.data;
    }, 'archive');
  }

  /**
   * Get validators information with optional filtering
   */
  async getValidators(
    stateId: string | number,
    validatorIndexes: string[] | null,
    statuses: string[] | null,
  ): Promise<GetValidators['data']> {
    return this.makeReliableRequest(async (url) => {
      const res = await this.axiosInstance.post<GetValidators>(
        `${url}/eth/v1/beacon/states/${stateId}/validators`,
        {
          ids: validatorIndexes,
          statuses,
        },
        {
          timeout: ms('1m'),
        },
      );
      return res.data.data;
    }, 'archive');
  }

  /**
   * Get attestation rewards for specific validators in an epoch
   */
  async getAttestationRewards(
    epoch: number,
    validatorIndexes: number[],
  ): Promise<AttestationRewards> {
    return this.makeReliableRequest(async (url) => {
      const res = await this.axiosInstance.post<AttestationRewards>(
        `${url}/eth/v1/beacon/rewards/attestations/${epoch}`,
        validatorIndexes.map((id) => id.toString()),
        {
          timeout: ms('1m'),
        },
      );
      return res.data;
    }, 'archive');
  }

  async getValidatorProposerDuties(epoch: number): Promise<ValidatorProposerDuties['data']> {
    return this.makeReliableRequest(async (url) => {
      const res = await this.axiosInstance.get<ValidatorProposerDuties>(
        `${url}/eth/v1/validator/duties/proposer/${epoch}`,
      );
      return res.data.data;
    }, 'full');
  }

  /**
   * Fetch block rewards for a slot without using the prefetch cache.
   */
  private fetchBlockRewardsUncached = async (
    slot: number,
  ): Promise<BlockRewards | 'SLOT MISSED'> => {
    return this.makeReliableRequest<BlockRewards | 'SLOT MISSED'>(
      async (url) => {
        const res = await this.axiosInstance.get<BlockRewards>(
          `${url}/eth/v1/beacon/rewards/blocks/${slot}`,
          {
            timeout: ms('1m'),
          },
        );
        return res.data;
      },
      this.isIndexerDelayed({ value: slot, type: 'slot' }) ? 'archive' : 'full',
      (error) => this.handleSlotError(error),
    );
  };

  /**
   * Prefetch block rewards for a delayed slot without blocking slot processing.
   */
  prefetchBlockRewards(slot: number): void {
    if (!this.isIndexerDelayed({ value: slot, type: 'slot' })) {
      return;
    }

    void this.blockRewardsCache.fetch(slot).catch(() => undefined);
  }

  /**
   * Get block rewards for a specific slot using the prefetch cache.
   */
  getBlockRewards = async (slot: number): Promise<BlockRewards | 'SLOT MISSED'> => {
    const rewards = await this.blockRewardsCache.fetch(slot);
    if (rewards === undefined) {
      throw new Error(`Failed to fetch block rewards for slot ${slot} from cache.`);
    }

    return rewards;
  };

  /**
   * Prefetch sync committee rewards for a delayed slot without blocking slot processing.
   */
  prefetchSyncCommitteeRewards(slot: number, validatorIndexes: string[]): void {
    if (!this.isIndexerDelayed({ value: slot, type: 'slot' }) || validatorIndexes.length === 0) {
      return;
    }

    const key = this.getSyncCommitteeRewardsCacheKey(slot, validatorIndexes);
    void this.syncCommitteeRewardsCache
      .fetch(key, { context: { ignoreErrors: true } })
      .catch(() => undefined);
  }

  /**
   * Get sync committee rewards for specific validators in a slot using the prefetch cache.
   */
  getSyncCommitteeRewards = async (
    slot: number,
    validatorIndexes: string[],
  ): Promise<SyncCommitteeRewards> => {
    if (validatorIndexes.length === 0) {
      return { data: [], execution_optimistic: false, finalized: true };
    }

    const key = this.getSyncCommitteeRewardsCacheKey(slot, validatorIndexes);
    let rewards = await this.syncCommitteeRewardsCache.fetch(key);
    if (rewards === undefined) {
      rewards = await this.syncCommitteeRewardsCache.fetch(key);
    }

    if (rewards === undefined) {
      throw new Error(`Failed to fetch sync committee rewards for slot ${slot} from cache.`);
    }

    return rewards;
  };
}
