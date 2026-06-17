import { describe, expect, it, vi } from 'vitest';

import { ClaimableWithdrawalsController } from './claimableWithdrawals.js';

const ADDRESS_ONE = '0x0000000000000000000000000000000000000001';
const ADDRESS_TWO = '0x0000000000000000000000000000000000000002';
const ADDRESS_THREE = '0x0000000000000000000000000000000000000003';

/**
 * Creates storage doubles that expose only the DB operations used by the controller.
 */
function createStorage() {
  return {
    listTrackedWithdrawalAddresses: vi.fn(),
    pruneUntrackedWithdrawalAddresses: vi.fn(),
    upsertClaimableAmounts: vi.fn(),
  };
}

/**
 * Creates an RPC reader double that exposes only the contract read operation.
 */
function createReader() {
  return {
    getWithdrawableAmounts: vi.fn(),
  };
}

describe('ClaimableWithdrawalsController', () => {
  // These controller tests verify chain gating and Gnosis RPC batching for claimable snapshots.
  it('returns immediately on Ethereum without querying DB or RPC', async () => {
    // This scenario protects Ethereum deployments from spending resources on Gnosis-only claimable work.
    const storage = createStorage();
    const reader = createReader();
    const controller = new ClaimableWithdrawalsController({
      chain: 'ethereum',
      reader,
      storage,
    });

    // Runs the hourly update on an Ethereum deployment.
    await controller.updateClaimableSnapshots();

    // Confirms the early return happens before any database or RPC dependency is touched.
    expect(storage.listTrackedWithdrawalAddresses).not.toHaveBeenCalled();
    expect(reader.getWithdrawableAmounts).not.toHaveBeenCalled();
    expect(storage.upsertClaimableAmounts).not.toHaveBeenCalled();
    expect(storage.pruneUntrackedWithdrawalAddresses).not.toHaveBeenCalled();
  });

  it('reads Gnosis withdrawable amounts in chunks and stores the raw amounts', async () => {
    // This scenario verifies the Gnosis path batches RPC calls and persists every returned address amount.
    const storage = createStorage();
    storage.listTrackedWithdrawalAddresses.mockResolvedValue([
      ADDRESS_ONE,
      ADDRESS_TWO,
      ADDRESS_THREE,
    ]);
    const reader = createReader();
    reader.getWithdrawableAmounts
      .mockResolvedValueOnce([
        { amountWei: 100n, withdrawalAddress: ADDRESS_ONE },
        { amountWei: 200n, withdrawalAddress: ADDRESS_TWO },
      ])
      .mockResolvedValueOnce([{ amountWei: 300n, withdrawalAddress: ADDRESS_THREE }]);
    const controller = new ClaimableWithdrawalsController({
      chain: 'gnosis',
      chunkSize: 2,
      reader,
      storage,
    });

    // Runs the hourly update with three tracked withdrawal addresses and a chunk size of two.
    await controller.updateClaimableSnapshots();

    // Confirms RPC reads are split into predictable chunks.
    expect(reader.getWithdrawableAmounts).toHaveBeenNthCalledWith(1, [ADDRESS_ONE, ADDRESS_TWO]);
    expect(reader.getWithdrawableAmounts).toHaveBeenNthCalledWith(2, [ADDRESS_THREE]);
    // Confirms all returned raw amounts are upserted before stale rows are pruned.
    expect(storage.upsertClaimableAmounts).toHaveBeenCalledWith([
      { amountWei: 100n, withdrawalAddress: ADDRESS_ONE },
      { amountWei: 200n, withdrawalAddress: ADDRESS_TWO },
      { amountWei: 300n, withdrawalAddress: ADDRESS_THREE },
    ]);
    expect(storage.pruneUntrackedWithdrawalAddresses).toHaveBeenCalledWith();
  });
});
