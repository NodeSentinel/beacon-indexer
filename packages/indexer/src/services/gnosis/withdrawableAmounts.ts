import chunk from 'lodash/chunk.js';
import { type Address, createPublicClient as createViemPublicClient, getAddress, http } from 'viem';
import { gnosis } from 'viem/chains';

import type { ClaimableWithdrawalAmount } from '@/src/services/consensus/storage/claimableWithdrawals.js';

const WITHDRAWABLE_AMOUNT_MULTICALL_BATCH_SIZE = 50;

const GNOSIS_DEPOSIT_ABI = [
  {
    inputs: [{ internalType: 'address', name: '_address', type: 'address' }],
    name: 'withdrawableAmount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

type GnosisDepositContractCall = {
  abi: typeof GNOSIS_DEPOSIT_ABI;
  address: Address;
  args: readonly [Address];
  functionName: 'withdrawableAmount';
};

type GnosisMulticallResult =
  | {
      result: bigint;
      status: 'success';
    }
  | {
      error: unknown;
      status: 'failure';
    };

type GnosisMulticallClient = {
  multicall: (params: {
    allowFailure: true;
    contracts: GnosisDepositContractCall[];
  }) => Promise<GnosisMulticallResult[]>;
};

type GnosisWithdrawableAmountsReaderParams = {
  bkpRpcUrl: string;
  depositContractAddress: string;
  mainRpcUrl: string;
};

/**
 * GnosisWithdrawableAmountsReader reads claimable withdrawal amounts from the Gnosis deposit contract.
 */
export class GnosisWithdrawableAmountsReader {
  private readonly depositContractAddress: Address;
  private readonly publicClients: GnosisMulticallClient[];

  constructor(params: GnosisWithdrawableAmountsReaderParams) {
    this.depositContractAddress = this.normalizeAddress(params.depositContractAddress);
    this.publicClients = [
      this.createPublicClient(params.mainRpcUrl),
      this.createPublicClient(params.bkpRpcUrl),
    ];
  }

  /**
   * Reads raw uint256 amounts using multicall batches capped to a conservative RPC-safe size.
   */
  async getWithdrawableAmounts(
    withdrawalAddresses: string[],
  ): Promise<ClaimableWithdrawalAmount[]> {
    const amounts: ClaimableWithdrawalAmount[] = [];

    for (const addressBatch of chunk(
      withdrawalAddresses,
      WITHDRAWABLE_AMOUNT_MULTICALL_BATCH_SIZE,
    )) {
      amounts.push(...(await this.readWithdrawableAmountBatch(addressBatch)));
    }

    return amounts;
  }

  /**
   * Creates a viem public client for the configured Gnosis RPC endpoint.
   */
  private createPublicClient(rpcUrl: string): GnosisMulticallClient {
    return createViemPublicClient({
      chain: gnosis,
      transport: http(rpcUrl, { timeout: 15_000 }),
    }) as unknown as GnosisMulticallClient;
  }

  /**
   * Reads one safe-sized address batch from main RPC and retries failed entries on the backup RPC.
   */
  private async readWithdrawableAmountBatch(
    withdrawalAddresses: string[],
  ): Promise<ClaimableWithdrawalAmount[]> {
    const amounts: ClaimableWithdrawalAmount[] = [];
    let pendingWithdrawalAddresses = withdrawalAddresses;

    for (const publicClient of this.publicClients) {
      if (pendingWithdrawalAddresses.length === 0) break;

      try {
        const result = await this.readWithdrawableAmountsFromClient(
          publicClient,
          pendingWithdrawalAddresses,
        );
        amounts.push(...result.amounts);
        pendingWithdrawalAddresses = result.failedWithdrawalAddresses;
      } catch {
        // A full RPC failure keeps the pending addresses available for the next configured RPC.
      }
    }

    return amounts;
  }

  /**
   * Executes one viem multicall and separates successful amounts from addresses that need retrying.
   */
  private async readWithdrawableAmountsFromClient(
    publicClient: GnosisMulticallClient,
    withdrawalAddresses: string[],
  ): Promise<{
    amounts: ClaimableWithdrawalAmount[];
    failedWithdrawalAddresses: string[];
  }> {
    const results = await publicClient.multicall({
      allowFailure: true,
      contracts: withdrawalAddresses.map((withdrawalAddress) => ({
        abi: GNOSIS_DEPOSIT_ABI,
        address: this.depositContractAddress,
        args: [this.normalizeAddress(withdrawalAddress)] as const,
        functionName: 'withdrawableAmount',
      })),
    });

    const amounts: ClaimableWithdrawalAmount[] = [];
    const failedWithdrawalAddresses: string[] = [];

    results.forEach((result, index) => {
      const withdrawalAddress = withdrawalAddresses[index];
      if (!withdrawalAddress) return;

      if (result.status === 'success') {
        amounts.push({ amountWei: result.result, withdrawalAddress });
        return;
      }

      failedWithdrawalAddresses.push(withdrawalAddress);
    });

    return { amounts, failedWithdrawalAddresses };
  }

  /**
   * Validates and normalizes an EVM address before using it in contract calls.
   */
  private normalizeAddress(address: string): Address {
    try {
      return getAddress(address);
    } catch {
      throw new Error(`Invalid EVM address: ${address}`);
    }
  }
}
