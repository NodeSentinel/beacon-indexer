import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  privateKeyToAccount,
  waitForTransactionReceipt,
  writeContract,
} = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  createWalletClient: vi.fn(),
  getAddress: vi.fn((address: string) => address),
  http: vi.fn((url: string) => ({ url })),
  privateKeyToAccount: vi.fn(() => ({ address: '0x0000000000000000000000000000000000000001' })),
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn(),
}));

vi.mock('viem', () => ({
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
}));

vi.mock('viem/accounts', () => ({
  privateKeyToAccount,
}));

vi.mock('viem/chains', () => ({
  gnosis: { id: 100, name: 'Gnosis' },
}));

import { createGnosisClaimWithdrawalsService } from './claim-withdrawals.js';

// Private key used only to exercise the wallet factory path in tests.
const PRIVATE_KEY = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
// Gnosis deposit-contract address used to verify contract write parameters.
const DEPOSIT_CONTRACT_ADDRESS = '0x0B98057eA310F4d31F2a452B414647007d1645d9';
// Explorer URL used to verify the returned transaction URL formatting.
const EXECUTION_EXPLORER_URL = 'https://gnosisscan.io';
// Fee recipient address passed to the claim transaction.
const FEE_RECIPIENT_ADDRESS = '0x0000000000000000000000000000000000000002';
// Transaction hash returned by the mocked wallet client after broadcast.
const TRANSACTION_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('createGnosisClaimWithdrawalsService', () => {
  // These tests cover service initialization and transaction broadcast behavior for Gnosis claims.
  beforeEach(() => {
    // Reset every viem mock so each test starts from an isolated client factory state.
    vi.clearAllMocks();
    createPublicClient.mockReturnValue({ waitForTransactionReceipt });
    createWalletClient.mockReturnValue({ writeContract });
    writeContract.mockResolvedValue(TRANSACTION_HASH);
  });

  it('does not create a claim service without an execution RPC URL', () => {
    // This scenario prevents creating viem clients with an unusable empty RPC transport.
    const service = createGnosisClaimWithdrawalsService({
      depositContractAddress: DEPOSIT_CONTRACT_ADDRESS,
      executionExplorerUrl: EXECUTION_EXPLORER_URL,
      privateKey: PRIVATE_KEY,
      rpcUrl: '',
    });

    // The factory should fail closed and avoid constructing any wallet or public client.
    expect(service).toBeNull();
    expect(createPublicClient).not.toHaveBeenCalled();
    expect(createWalletClient).not.toHaveBeenCalled();
  });

  it('returns the broadcast transaction hash without waiting for the receipt', async () => {
    // This scenario keeps the HTTP claim request from blocking on chain confirmation.
    const service = createGnosisClaimWithdrawalsService({
      depositContractAddress: DEPOSIT_CONTRACT_ADDRESS,
      executionExplorerUrl: EXECUTION_EXPLORER_URL,
      privateKey: PRIVATE_KEY,
      rpcUrl: 'https://rpc.gnosischain.com',
    });

    // Broadcast a claim for one fee recipient through the service returned by the factory.
    const result = await service?.claimWithdrawals([FEE_RECIPIENT_ADDRESS]);

    // The wallet client should broadcast one claimWithdrawals transaction with normalized addresses.
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: DEPOSIT_CONTRACT_ADDRESS,
        functionName: 'claimWithdrawals',
        args: [[FEE_RECIPIENT_ADDRESS]],
      }),
    );
    // The service should return immediately after broadcast and leave confirmation monitoring out of band.
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(result).toEqual({
      transactionHash: TRANSACTION_HASH,
      transactionUrl: `${EXECUTION_EXPLORER_URL}/tx/${TRANSACTION_HASH}`,
    });
  });
});
