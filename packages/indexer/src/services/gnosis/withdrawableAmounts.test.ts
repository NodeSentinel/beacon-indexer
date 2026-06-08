import { describe, expect, it, vi } from 'vitest';

import { GnosisWithdrawableAmountsReader } from './withdrawableAmounts.js';

// ADDRESS_ONE represents a tracked withdrawal address whose contract read succeeds.
const ADDRESS_ONE = '0x0000000000000000000000000000000000000001';
// ADDRESS_TWO represents a tracked withdrawal address that fails on every configured RPC.
const ADDRESS_TWO = '0x0000000000000000000000000000000000000002';
// ADDRESS_THREE represents another tracked withdrawal address that must not be blocked by failures.
const ADDRESS_THREE = '0x0000000000000000000000000000000000000003';

/**
 * Reads the private axios client used by the Gnosis reader so tests can control RPC responses.
 */
function getAxiosInstance(reader: GnosisWithdrawableAmountsReader): { post: unknown } {
  return (reader as unknown as { axiosInstance: { post: unknown } }).axiosInstance;
}

describe('GnosisWithdrawableAmountsReader', () => {
  // This suite verifies per-address RPC failures do not block the entire claimable snapshot batch.
  it('skips addresses that fail on every RPC and returns successful reads', async () => {
    // This scenario prevents one permanently failing address from blocking the hourly snapshot update.
    const reader = new GnosisWithdrawableAmountsReader({
      bkpRpcUrl: 'https://backup-rpc.example',
      depositContractAddress: '0x0000000000000000000000000000000000000100',
      mainRpcUrl: 'https://main-rpc.example',
    });
    const axiosInstance = getAxiosInstance(reader);
    const postSpy = vi.spyOn(axiosInstance, 'post' as never).mockImplementation(((
      _rpcUrl: string,
      body: { params: [{ data: string }] },
    ) => {
      // This mocked RPC fails the second address on both main and backup endpoints.
      if (body.params[0].data.endsWith(ADDRESS_TWO.slice(2).padStart(64, '0'))) {
        return Promise.reject(new Error('rate limited'));
      }

      // This mocked RPC returns one raw uint256 amount for every address that is not failing.
      return Promise.resolve({ data: { jsonrpc: '2.0', id: 1, result: '0x64' } });
    }) as never);

    // Reads three addresses while the middle address fails all RPC attempts.
    const amounts = await reader.getWithdrawableAmounts([ADDRESS_ONE, ADDRESS_TWO, ADDRESS_THREE]);

    // Confirms successful addresses are preserved and the failed address keeps its last snapshot value.
    expect(amounts).toEqual([
      { amountWei: 100n, withdrawalAddress: ADDRESS_ONE },
      { amountWei: 100n, withdrawalAddress: ADDRESS_THREE },
    ]);
    // Confirms the failed address was attempted on the main RPC and then the backup RPC.
    expect(postSpy).toHaveBeenCalledTimes(4);
  });
});
