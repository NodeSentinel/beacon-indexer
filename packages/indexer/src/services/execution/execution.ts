import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import ms from 'ms';
import pLimit from 'p-limit';
import pRetry from 'p-retry';

import { logError, logRequest, logResponse } from '@/src/lib/httpPino.js';
import {
  Blockscout_Blocks,
  Etherscan_BlockReward,
  JsonRpcResponse,
  QuickNode_Block,
  QuickNode_TransactionReceipt,
} from '@/src/services/execution/types.js';

export type BlockResponse = {
  address: string;
  timestamp: Date;
  amount: string; // wei value as string (e.g. "5003150000000000000")
  blockNumber: number;
};

export interface ExecutionClientConfig {
  executionBlockscoutUrl: string;
  executionBlockscoutKey?: string;
  executionEtherscanUrl: string;
  executionEtherscanKey?: string;
  executionQuicknodeUrl: string;
  executionQuicknodeKey?: string;
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
    this.axiosInstance = axios.create({ timeout: ms('2.5s') });

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
      const etherscanEndpoint = {
        name: 'Etherscan',
        fetch: async (): Promise<BlockResponse> => {
          // https://api.etherscan.io/v2/api?chainid=1&module=block&action=getblockreward&blockno=2165403&apikey=YourApiKeyToken
          const url = `${this.config.executionEtherscanUrl}/api?chainid=${this.config.chainId}&module=block&action=getblockreward&blockno=${blockNumber}&apikey=${this.config.executionEtherscanKey || ''}`;
          const response = await this.axiosInstance.get<Etherscan_BlockReward>(url);
          const blockInfo = response.data;

          if (blockInfo.status !== '1' || blockInfo.message !== 'OK') {
            throw new Error(
              `Etherscan API error: ${blockInfo.message} (status: ${blockInfo.status})`,
            );
          }

          if (!blockInfo.result?.blockMiner || !blockInfo.result?.blockReward) {
            throw new Error(`Unexpected Etherscan block response: ${JSON.stringify(blockInfo)}`);
          }

          return {
            address: blockInfo.result.blockMiner,
            timestamp: new Date(Number(blockInfo.result.timeStamp) * 1000),
            amount: blockInfo.result.blockReward,
            blockNumber: Number(blockInfo.result.blockNumber),
          };
        },
      };

      const blockscoutEndpoint = {
        name: 'Blockscout',
        fetch: async (): Promise<BlockResponse> => {
          const url = `${this.config.executionBlockscoutUrl}/api/v2/blocks/${blockNumber}`;
          const response = await this.axiosInstance.get<Blockscout_Blocks>(url);
          const blockInfo = response.data;
          const minerReward = blockInfo.rewards.find((r) => r.type === 'Miner Reward');

          if (!minerReward || blockInfo.rewards.length === 0) {
            return {
              address: blockInfo.miner?.hash ?? '',
              timestamp: new Date(blockInfo.timestamp),
              amount: '0',
              blockNumber: blockInfo.height,
            };
          }

          if (!blockInfo.miner || !blockInfo.miner.hash) {
            throw new Error(`Unexpected block response: ${JSON.stringify(blockInfo)}`);
          }

          return {
            address: blockInfo.miner.hash,
            timestamp: new Date(blockInfo.timestamp),
            amount: minerReward?.reward ?? '0',
            blockNumber: blockInfo.height,
          };
        },
      };

      const quicknodeEndpoint = {
        name: 'QuickNode',
        fetch: async (): Promise<BlockResponse> => {
          const baseUrl = this.config.executionQuicknodeUrl.replace(/\/$/, '');
          const quicknodeUrl = this.config.executionQuicknodeKey
            ? `${baseUrl}/${this.config.executionQuicknodeKey}`
            : baseUrl;
          const hexBlock = `0x${blockNumber.toString(16)}`;

          // Single batch JSON-RPC request for block header + receipts
          const batchRes = await this.axiosInstance.post<
            [JsonRpcResponse<QuickNode_Block>, JsonRpcResponse<QuickNode_TransactionReceipt[]>]
          >(quicknodeUrl, [
            {
              jsonrpc: '2.0',
              id: 1,
              method: 'eth_getBlockByNumber',
              params: [hexBlock, false],
            },
            { jsonrpc: '2.0', id: 2, method: 'eth_getBlockReceipts', params: [hexBlock] },
          ]);

          const [blockRpc, receiptsRpc] = batchRes.data;

          if (blockRpc.error) {
            throw new Error(`QuickNode eth_getBlockByNumber error: ${blockRpc.error.message}`);
          }
          if (receiptsRpc.error) {
            throw new Error(`QuickNode eth_getBlockReceipts error: ${receiptsRpc.error.message}`);
          }

          const block = blockRpc.result;
          const receipts = receiptsRpc.result;

          if (!block || !receipts) {
            throw new Error(`QuickNode returned null for block ${blockNumber}`);
          }

          const baseFee = BigInt(block.baseFeePerGas);

          // Total priority fees = sum of (effectiveGasPrice - baseFeePerGas) * gasUsed
          let totalPriorityFees = 0n;
          for (const receipt of receipts) {
            const effectiveGasPrice = BigInt(receipt.effectiveGasPrice);
            const gasUsed = BigInt(receipt.gasUsed);
            const tip = effectiveGasPrice - baseFee;
            if (tip > 0n) {
              totalPriorityFees += tip * gasUsed;
            }
          }

          return {
            address: block.miner,
            timestamp: new Date(Number(BigInt(block.timestamp)) * 1000),
            amount: totalPriorityFees.toString(),
            blockNumber: Number(BigInt(block.number)),
          };
        },
      };

      // Gnosis: Blockscout > QuickNode (Etherscan doesn't support getblockreward for Gnosis)
      // Ethereum: Etherscan > Blockscout > QuickNode
      const isGnosis = this.config.chainId === 100;
      const endpoints = isGnosis
        ? [quicknodeEndpoint, blockscoutEndpoint]
        : [etherscanEndpoint, quicknodeEndpoint, blockscoutEndpoint];

      // Try all endpoints in sequence, then backoff and retry the full cycle
      return await pRetry(
        async () => {
          let lastError: unknown;

          for (const endpoint of endpoints) {
            try {
              return await endpoint.fetch();
            } catch (error) {
              const status = axios.isAxiosError(error) ? error.response?.status : undefined;
              const responseData = axios.isAxiosError(error) ? error.response?.data : undefined;

              const context =
                `[${endpoint.name}] failed for block ${blockNumber}` +
                (status ? ` (HTTP ${status})` : '') +
                (responseData
                  ? ` - response: ${JSON.stringify(responseData)}`
                  : ` - ${error instanceof Error ? error.message : String(error)}`);

              lastError = new Error(context, { cause: error });
            }
          }

          throw lastError || new Error(`All endpoints failed for block ${blockNumber}`);
        },
        {
          retries: 30,
          minTimeout: ms('1s'),
        },
      );
    });
  }
}
