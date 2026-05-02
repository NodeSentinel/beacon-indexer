import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import ms from 'ms';
import pLimit from 'p-limit';

import { logError, logRequest, logResponse } from '@/src/lib/httpPino.js';
import {
  JsonRpcResponse,
  RpcBlock,
  RpcTransactionReceipt,
} from '@/src/services/execution/types.js';

export type BlockResponse = {
  address: string;
  timestamp: Date;
  amount: string; // wei value as string (e.g. "5003150000000000000")
  blockNumber: number;
};

export interface ExecutionClientConfig {
  mainExecutionRpc: string;
  bkpExecutionRpc: string;
  requestsPerSecond: number;
}

/**
 * ExecutionClient fetches execution block rewards from generic JSON-RPC endpoints.
 */
export class ExecutionClient {
  private readonly axiosInstance: AxiosInstance;
  private readonly config: ExecutionClientConfig;
  private readonly limiter: ReturnType<typeof pLimit>;

  constructor(config: ExecutionClientConfig) {
    this.config = config;
    this.limiter = pLimit(config.requestsPerSecond);
    this.axiosInstance = axios.create({ timeout: ms('2.5s') });

    // Log every execution RPC request before it is sent.
    this.axiosInstance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      logRequest(config);
      return config;
    });

    this.axiosInstance.interceptors.response.use(logResponse, logError);
  }

  /**
   * Fetch execution block rewards from the main RPC and fallback RPC.
   */
  async getBlock(blockNumber: number): Promise<BlockResponse> {
    return await this.fetchBlockWithFallback(blockNumber);
  }

  /**
   * Try main and backup RPC endpoints as a pair before applying exponential backoff.
   */
  private async fetchBlockWithFallback(blockNumber: number): Promise<BlockResponse> {
    const maxCycles = 5;
    const baseDelayMs = 100;
    let lastError: unknown;

    for (let cycle = 0; cycle < maxCycles; cycle++) {
      for (const endpoint of this.getRpcEndpoints()) {
        try {
          return await this.fetchBlockFromRpc(endpoint.url, blockNumber);
        } catch (error) {
          lastError = new Error(
            `[${endpoint.name}] failed for block ${blockNumber}${this.formatErrorContext(error)}`,
            { cause: error },
          );
        }
      }

      if (cycle < maxCycles - 1) {
        await this.wait(baseDelayMs * Math.pow(2, cycle));
      }
    }

    throw lastError || new Error(`All execution RPC endpoints failed for block ${blockNumber}`);
  }

  /**
   * Return the execution RPC endpoints in the order they should be tried.
   */
  private getRpcEndpoints(): Array<{ name: 'MAIN' | 'BKP'; url: string }> {
    return [
      { name: 'MAIN', url: this.config.mainExecutionRpc },
      { name: 'BKP', url: this.config.bkpExecutionRpc },
    ];
  }

  /**
   * Fetch and parse one execution block using standard JSON-RPC methods.
   */
  private async fetchBlockFromRpc(url: string, blockNumber: number): Promise<BlockResponse> {
    const hexBlock = `0x${blockNumber.toString(16)}`;

    // Fetch the block header and receipts together so reward calculation uses one block view.
    const batchRes = await this.limiter(() =>
      this.axiosInstance.post<
        Array<JsonRpcResponse<RpcBlock> | JsonRpcResponse<RpcTransactionReceipt[]>>
      >(url, [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBlockByNumber',
          params: [hexBlock, false],
        },
        { jsonrpc: '2.0', id: 2, method: 'eth_getBlockReceipts', params: [hexBlock] },
      ]),
    );

    const responses = batchRes.data;

    if (!Array.isArray(responses)) {
      throw new Error(`Execution RPC returned invalid batch response for block ${blockNumber}`);
    }

    const blockRpc = responses.find((response) => response.id === 1) as
      | JsonRpcResponse<RpcBlock>
      | undefined;
    const receiptsRpc = responses.find((response) => response.id === 2) as
      | JsonRpcResponse<RpcTransactionReceipt[]>
      | undefined;

    if (!blockRpc || !receiptsRpc) {
      throw new Error(`Execution RPC batch response missing results for block ${blockNumber}`);
    }

    if (blockRpc.error) {
      throw new Error(`eth_getBlockByNumber error: ${blockRpc.error.message}`);
    }
    if (receiptsRpc.error) {
      throw new Error(`eth_getBlockReceipts error: ${receiptsRpc.error.message}`);
    }

    const block = blockRpc.result;
    const receipts = receiptsRpc.result;

    if (!block || !receipts) {
      throw new Error(`Execution RPC returned null for block ${blockNumber}`);
    }

    return {
      address: block.miner,
      timestamp: new Date(Number(BigInt(block.timestamp)) * 1000),
      amount: this.calculatePriorityFees(block.baseFeePerGas, receipts),
      blockNumber: Number(BigInt(block.number)),
    };
  }

  /**
   * Calculate the total priority fees paid to the execution block fee recipient.
   */
  private calculatePriorityFees(baseFeePerGas: string, receipts: RpcTransactionReceipt[]): string {
    const baseFee = BigInt(baseFeePerGas);
    let totalPriorityFees = 0n;

    for (const receipt of receipts) {
      const effectiveGasPrice = BigInt(receipt.effectiveGasPrice);
      const gasUsed = BigInt(receipt.gasUsed);
      const tip = effectiveGasPrice - baseFee;

      if (tip > 0n) {
        totalPriorityFees += tip * gasUsed;
      }
    }

    return totalPriorityFees.toString();
  }

  /**
   * Wait for the given number of milliseconds before the next retry cycle.
   */
  private async wait(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * Format HTTP and RPC error context for retry failure messages.
   */
  private formatErrorContext(error: unknown): string {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const responseData = axios.isAxiosError(error) ? error.response?.data : undefined;
    const message = error instanceof Error ? error.message : String(error);

    return (
      (status ? ` (HTTP ${status})` : '') +
      (responseData ? ` - response: ${JSON.stringify(responseData)}` : ` - ${message}`)
    );
  }
}
