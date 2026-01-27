import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import pLimit from 'p-limit';

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
}

/**
 * ExecutionClient - Client for execution layer endpoints
 * Similar pattern to BeaconClient, receives configuration via constructor
 */
export class ExecutionClient {
  private readonly axiosInstance: AxiosInstance;
  private readonly config: ExecutionClientConfig;
  private readonly limiter: ReturnType<typeof pLimit>;

  constructor(config: ExecutionClientConfig) {
    this.config = config;
    this.limiter = pLimit(config.requestsPerSecond);
    this.axiosInstance = axios.create();

    // Setup interceptors
    this.axiosInstance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      logRequest(config);
      return config;
    });

    this.axiosInstance.interceptors.response.use(logResponse, logError);
  }

  async getBlock(blockNumber: number): Promise<BlockResponse | null> {
    return this.limiter(async () => {
      let lastError: unknown;

      // First endpoint is blockscout, second is etherscan
      const endpoints = [
        // Blockscout
        // https://eth.blockscout.com/api/v2/blocks
        {
          url: `${this.config.executionApiUrl}/api/v2/blocks/${blockNumber}`,
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
        // Etherscan
        // https://api.etherscan.io/v2/api?chainid=1&module=block&action=getblockreward&blockno=2165403&apikey=YourApiKeyToken
        {
          url: `${this.config.executionApiBkpUrl}/api?chainid=${this.config.chainId}&module=block&action=getblockreward&blockno=${blockNumber}&apikey=${this.config.executionApiBkpKey || ''}`,
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
      ];

      // Try each endpoint
      for (let i = 0; i < endpoints.length; i++) {
        const endpoint = endpoints[i];
        try {
          const response = await this.axiosInstance.get(endpoint.url);
          return endpoint.process(response);
        } catch (error) {
          lastError = error;

          // Wait one slot before trying the next endpoint
          if (i < endpoints.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, this.config.slotDuration));
          }
        }
      }

      // If all endpoints fail, throw the last error
      throw lastError;
    });
  }
}
