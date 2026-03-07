import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import ms from 'ms';
import pLimit from 'p-limit';
import pRetry from 'p-retry';

import { logError, logRequest, logResponse } from '@/src/lib/httpPino.js';
import { Blockscout_Blocks, Etherscan_BlockReward } from '@/src/services/execution/types.js';

export type BlockResponse = {
  address: string;
  timestamp: Date;
  amount: string; // wei value as string (e.g. "5003150000000000000")
  blockNumber: number;
};

export interface ExecutionClientConfig {
  executionApiUrl: string;
  executionApiBkpUrl: string;
  executionApiBkpKey?: string;
  chainId: number;
  slotDuration: number;
  requestsPerSecond: number;
  retries?: number; // Number of retries per endpoint (default: 30, similar to archive node)
  baseDelay?: number; // Base delay in milliseconds for exponential backoff (default: 1s)
}

/**
 * ExecutionClient - Client for execution layer endpoints
 * Similar pattern to BeaconClient, receives configuration via constructor
 */
export class ExecutionClient {
  private readonly axiosInstance: AxiosInstance;
  private readonly config: ExecutionClientConfig & {
    retries: number;
    baseDelay: number;
  };
  private readonly limiter: ReturnType<typeof pLimit>;

  constructor(config: ExecutionClientConfig) {
    this.config = {
      ...config,
      retries: config.retries ?? 30, // Default to 30 retries like archive node
      baseDelay: config.baseDelay ?? ms('1s'), // Default to 1s base delay
    };
    this.limiter = pLimit(config.requestsPerSecond);
    this.axiosInstance = axios.create({ timeout: ms('3s') });

    // Setup interceptors
    this.axiosInstance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      logRequest(config);
      return config;
    });

    this.axiosInstance.interceptors.response.use(logResponse, logError);
  }

  async getBlock(blockNumber: number): Promise<BlockResponse | null> {
    return this.limiter(async () => {
      // Define endpoints
      const endpoints = [
        // Etherscan
        // https://api.etherscan.io/v2/api?chainid=1&module=block&action=getblockreward&blockno=2165403&apikey=YourApiKeyToken
        {
          url: `${this.config.executionApiBkpUrl}/api?chainid=${this.config.chainId}&module=block&action=getblockreward&blockno=${blockNumber}&apikey=${this.config.executionApiBkpKey || ''}`,
          name: 'Etherscan',
          process: (response: AxiosResponse<Etherscan_BlockReward>) => {
            const blockInfo = response.data;

            // Check if API call was successful
            if (blockInfo.status !== '1' || blockInfo.message !== 'OK') {
              throw new Error(
                `Etherscan API error: ${blockInfo.message} (status: ${blockInfo.status})`,
              );
            }

            // Validate required fields
            if (!blockInfo.result?.blockMiner || !blockInfo.result?.blockReward) {
              throw new Error(`Unexpected Etherscan block response: ${JSON.stringify(blockInfo)}`);
            }

            const result: BlockResponse = {
              address: blockInfo.result.blockMiner,
              timestamp: new Date(Number(blockInfo.result.timeStamp) * 1000),
              amount: blockInfo.result.blockReward,
              blockNumber: Number(blockInfo.result.blockNumber),
            };
            return result;
          },
        },
        // Blockscout
        // https://eth.blockscout.com/api/v2/blocks
        {
          url: `${this.config.executionApiUrl}/api/v2/blocks/${blockNumber}`,
          name: 'Blockscout',
          process: (response: AxiosResponse<Blockscout_Blocks>) => {
            const blockInfo = response.data;
            const minerReward = blockInfo.rewards.find((r) => r.type === 'Miner Reward');

            if (!blockInfo.miner || !blockInfo.miner.hash || !minerReward) {
              throw new Error(`Unexpected block response: ${JSON.stringify(blockInfo)}`);
            }

            const result: BlockResponse = {
              address: blockInfo.miner.hash,
              timestamp: new Date(blockInfo.timestamp),
              amount: minerReward?.reward ?? '0',
              blockNumber: blockInfo.height,
            };
            return result;
          },
        },
      ];

      // Try all endpoints in sequence, then backoff and retry the full cycle
      return await pRetry(
        async () => {
          let lastError: unknown;

          for (const endpoint of endpoints) {
            try {
              const response = await this.axiosInstance.get(endpoint.url);
              return endpoint.process(response);
            } catch (error) {
              lastError = error;
            }
          }

          throw lastError || new Error(`All endpoints failed for block ${blockNumber}`);
        },
        {
          retries: this.config.retries,
          minTimeout: ms('1s'),
        },
      );
    });
  }
}
