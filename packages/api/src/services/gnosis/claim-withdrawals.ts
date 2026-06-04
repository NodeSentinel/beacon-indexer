import type { Address, Hex } from 'viem';
import { createPublicClient, createWalletClient, getAddress, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';

const GNOSIS_DEPOSIT_ABI = [
  {
    inputs: [{ internalType: 'address[]', name: '_addresses', type: 'address[]' }],
    name: 'claimWithdrawals',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export interface ClaimWithdrawalsService {
  /** Sends one Gnosis deposit-contract claim transaction for the provided fee recipients. */
  claimWithdrawals(addresses: string[]): Promise<{
    transactionHash: Hex;
    transactionUrl: string;
  }>;
}

interface CreateGnosisClaimWithdrawalsServiceParams {
  depositContractAddress?: string;
  executionExplorerUrl?: string;
  privateKey?: string;
  rpcUrl: string;
}

/** Creates a claim service only when every signing-related setting is available. */
export function createGnosisClaimWithdrawalsService(
  params: CreateGnosisClaimWithdrawalsServiceParams,
): ClaimWithdrawalsService | null {
  if (!params.privateKey || !params.depositContractAddress || !params.executionExplorerUrl) {
    return null;
  }

  const account = privateKeyToAccount(params.privateKey as Hex);
  const publicClient = createPublicClient({
    chain: gnosis,
    transport: http(params.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: gnosis,
    transport: http(params.rpcUrl),
  });
  const contractAddress = getAddress(params.depositContractAddress);
  const explorerUrl = params.executionExplorerUrl.replace(/\/$/, '');

  return {
    /** Sends the claim transaction and waits for the receipt before returning the explorer URL. */
    async claimWithdrawals(addresses: string[]) {
      const normalizedAddresses = addresses.map((address) => getAddress(address) as Address);
      const transactionHash = await walletClient.writeContract({
        address: contractAddress,
        abi: GNOSIS_DEPOSIT_ABI,
        functionName: 'claimWithdrawals',
        args: [normalizedAddresses],
      });

      await publicClient.waitForTransactionReceipt({ hash: transactionHash });

      return {
        transactionHash,
        transactionUrl: `${explorerUrl}/tx/${transactionHash}`,
      };
    },
  };
}
