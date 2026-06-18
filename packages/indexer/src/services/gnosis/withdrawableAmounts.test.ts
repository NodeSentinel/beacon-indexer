import { describe, expect, it, vi } from 'vitest';

import { GnosisWithdrawableAmountsReader } from './withdrawableAmounts.js';

// ADDRESS_ONE represents a tracked withdrawal address whose contract read succeeds.
const ADDRESS_ONE = '0x0000000000000000000000000000000000000001';
// ADDRESS_TWO represents a tracked withdrawal address that fails on every configured RPC.
const ADDRESS_TWO = '0x0000000000000000000000000000000000000002';
// ADDRESS_THREE represents another tracked withdrawal address that must not be blocked by failures.
const ADDRESS_THREE = '0x0000000000000000000000000000000000000003';

type MulticallClientDouble = {
  multicall: (params: {
    allowFailure: true;
    contracts: Array<{
      abi: unknown;
      address: string;
      args: readonly [string];
      functionName: string;
    }>;
  }) => Promise<unknown>;
};

/**
 * Reads the private multicall clients used by the Gnosis reader so tests can control RPC behavior.
 */
function getPublicClients(reader: GnosisWithdrawableAmountsReader): MulticallClientDouble[] {
  return (reader as unknown as { publicClients: MulticallClientDouble[] }).publicClients;
}

/**
 * Builds deterministic withdrawal addresses so batch-size tests can assert exact multicall sizes.
 */
function createWithdrawalAddresses(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `0x${(index + 1).toString(16).padStart(40, '0')}`,
  );
}

/**
 * Creates successful multicall responses using the same raw amount for every contract call.
 */
function createSuccessfulMulticallResults(count: number) {
  return Array.from({ length: count }, () => ({ result: 100n, status: 'success' as const }));
}

/**
 * Creates a reader and exposes its viem clients so each test can stub RPC behavior precisely.
 */
function createReaderWithClients() {
  const reader = new GnosisWithdrawableAmountsReader({
    bkpRpcUrl: 'https://backup-rpc.example',
    depositContractAddress: '0x0000000000000000000000000000000000000100',
    mainRpcUrl: 'https://main-rpc.example',
  });

  return { publicClients: getPublicClients(reader), reader };
}

describe('GnosisWithdrawableAmountsReader', () => {
  // This suite verifies per-address RPC failures do not block the entire claimable snapshot batch.
  it('reads through viem multicall contract calls against the deposit contract', async () => {
    // This scenario verifies the reader delegates ABI encoding and Multicall3 transport to viem.
    const { publicClients, reader } = createReaderWithClients();
    const [mainClient] = publicClients;
    const multicallSpy = vi.spyOn(mainClient, 'multicall').mockResolvedValueOnce([
      { result: 100n, status: 'success' },
      { result: 200n, status: 'success' },
    ]);

    // Reads two addresses so the test can inspect one viem multicall request with two contracts.
    const amounts = await reader.getWithdrawableAmounts([ADDRESS_ONE, ADDRESS_TWO]);

    // Confirms viem results are mapped back to the original withdrawal addresses.
    expect(amounts).toEqual([
      { amountWei: 100n, withdrawalAddress: ADDRESS_ONE },
      { amountWei: 200n, withdrawalAddress: ADDRESS_TWO },
    ]);
    // Confirms the reader passes deposit-contract read calls to viem instead of building JSON-RPC.
    expect(multicallSpy.mock.calls[0]?.[0]).toMatchObject({
      allowFailure: true,
      contracts: [
        {
          address: '0x0000000000000000000000000000000000000100',
          args: [ADDRESS_ONE],
          functionName: 'withdrawableAmount',
        },
        {
          address: '0x0000000000000000000000000000000000000100',
          args: [ADDRESS_TWO],
          functionName: 'withdrawableAmount',
        },
      ],
    });
    expect(multicallSpy.mock.calls[0]?.[0].contracts[0]?.abi).toBeDefined();
  });

  it('reads withdrawable amounts through sequential multicall batches of 50 addresses', async () => {
    // This scenario keeps direct reader calls from creating oversized multicall payloads.
    const { publicClients, reader } = createReaderWithClients();
    const [mainClient, backupClient] = publicClients;
    const mainMulticall = vi
      .spyOn(mainClient, 'multicall')
      .mockResolvedValueOnce(createSuccessfulMulticallResults(50))
      .mockResolvedValueOnce(createSuccessfulMulticallResults(50))
      .mockResolvedValueOnce(createSuccessfulMulticallResults(20));
    const backupMulticall = vi.spyOn(backupClient, 'multicall');

    // Reads more addresses than one safe multicall request should carry.
    const amounts = await reader.getWithdrawableAmounts(createWithdrawalAddresses(120));

    // Confirms all successful results are returned from three safe-sized multicall batches.
    expect(amounts).toHaveLength(120);
    expect(mainMulticall).toHaveBeenCalledTimes(3);
    expect(mainMulticall.mock.calls[0]?.[0].contracts).toHaveLength(50);
    expect(mainMulticall.mock.calls[1]?.[0].contracts).toHaveLength(50);
    expect(mainMulticall.mock.calls[2]?.[0].contracts).toHaveLength(20);
    // Confirms backup RPC is not used when the main RPC returns every amount successfully.
    expect(backupMulticall).not.toHaveBeenCalled();
  });

  it('skips addresses that fail on every RPC and returns successful reads', async () => {
    // This scenario prevents one permanently failing address from blocking the hourly snapshot update.
    const { publicClients, reader } = createReaderWithClients();
    const [mainClient, backupClient] = publicClients;
    const mainMulticall = vi.spyOn(mainClient, 'multicall').mockResolvedValueOnce([
      { result: 100n, status: 'success' },
      { error: new Error('rate limited'), status: 'failure' },
      { result: 100n, status: 'success' },
    ]);
    const backupMulticall = vi
      .spyOn(backupClient, 'multicall')
      .mockResolvedValueOnce([{ error: new Error('backup rate limited'), status: 'failure' }]);

    // Reads three addresses while the middle address fails all RPC attempts.
    const amounts = await reader.getWithdrawableAmounts([ADDRESS_ONE, ADDRESS_TWO, ADDRESS_THREE]);

    // Confirms successful addresses are preserved and the failed address keeps its last snapshot value.
    expect(amounts).toEqual([
      { amountWei: 100n, withdrawalAddress: ADDRESS_ONE },
      { amountWei: 100n, withdrawalAddress: ADDRESS_THREE },
    ]);
    // Confirms only the failed address is retried on the backup RPC.
    expect(mainMulticall.mock.calls[0]?.[0].contracts).toHaveLength(3);
    expect(backupMulticall.mock.calls[0]?.[0].contracts).toHaveLength(1);
  });
});
