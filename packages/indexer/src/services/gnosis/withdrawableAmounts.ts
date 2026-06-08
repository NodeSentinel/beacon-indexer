import axios, { AxiosInstance } from 'axios';
import ms from 'ms';

import type { ClaimableWithdrawalAmount } from '@/src/services/consensus/storage/claimableWithdrawals.js';
import type { JsonRpcResponse } from '@/src/services/execution/types.js';

const WITHDRAWABLE_AMOUNT_SELECTOR = '0xbe7ab51b';

type GnosisWithdrawableAmountsReaderParams = {
  bkpRpcUrl: string;
  depositContractAddress: string;
  mainRpcUrl: string;
};

/**
 * GnosisWithdrawableAmountsReader reads claimable withdrawal amounts from the Gnosis deposit contract.
 */
export class GnosisWithdrawableAmountsReader {
  private readonly axiosInstance: AxiosInstance;
  private readonly depositContractAddress: string;
  private readonly rpcUrls: string[];

  constructor(params: GnosisWithdrawableAmountsReaderParams) {
    this.axiosInstance = axios.create();
    this.depositContractAddress = this.normalizeAddress(params.depositContractAddress);
    this.rpcUrls = [params.mainRpcUrl, params.bkpRpcUrl];
  }

  /**
   * Reads raw uint256 amounts for each withdrawal address and returns values keyed by original address.
   */
  async getWithdrawableAmounts(
    withdrawalAddresses: string[],
  ): Promise<ClaimableWithdrawalAmount[]> {
    const amounts = await Promise.all(
      withdrawalAddresses.map(async (withdrawalAddress) => {
        try {
          return {
            amountWei: await this.readWithdrawableAmount(withdrawalAddress),
            withdrawalAddress,
          };
        } catch {
          return null;
        }
      }),
    );

    return amounts.filter((amount): amount is ClaimableWithdrawalAmount => amount !== null);
  }

  /**
   * Reads one withdrawal address from the main RPC and then the backup RPC if needed.
   */
  private async readWithdrawableAmount(withdrawalAddress: string): Promise<bigint> {
    let lastError: unknown;

    for (const rpcUrl of this.rpcUrls) {
      try {
        return await this.readWithdrawableAmountFromRpc(rpcUrl, withdrawalAddress);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to read withdrawableAmount for ${withdrawalAddress}`);
  }

  /**
   * Sends one eth_call for withdrawableAmount(address) and parses the uint256 result.
   */
  private async readWithdrawableAmountFromRpc(
    rpcUrl: string,
    withdrawalAddress: string,
  ): Promise<bigint> {
    const response = await this.axiosInstance.post<JsonRpcResponse<string>>(
      rpcUrl,
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            data: this.encodeWithdrawableAmountCall(withdrawalAddress),
            to: this.depositContractAddress,
          },
          'latest',
        ],
      },
      { timeout: ms('15s') },
    );

    if (response.data.error) {
      throw new Error(`eth_call withdrawableAmount error: ${response.data.error.message}`);
    }

    if (!response.data.result) {
      throw new Error(`eth_call withdrawableAmount returned empty result for ${withdrawalAddress}`);
    }

    return BigInt(response.data.result);
  }

  /**
   * Encodes withdrawableAmount(address) calldata for a normalized Ethereum address.
   */
  private encodeWithdrawableAmountCall(withdrawalAddress: string): string {
    const normalizedAddress = this.normalizeAddress(withdrawalAddress).slice(2);
    return `${WITHDRAWABLE_AMOUNT_SELECTOR}${normalizedAddress.padStart(64, '0')}`;
  }

  /**
   * Validates and lowercases an EVM address before using it in contract calls.
   */
  private normalizeAddress(address: string): string {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error(`Invalid EVM address: ${address}`);
    }

    return address.toLowerCase();
  }
}
