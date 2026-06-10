import type { Chain } from '@beacon-indexer/beacon-utils';
import chunk from 'lodash/chunk.js';

import type { ClaimableWithdrawalAmount } from '../storage/claimableWithdrawals.js';

type ClaimableWithdrawalsReader = {
  getWithdrawableAmounts: (withdrawalAddresses: string[]) => Promise<ClaimableWithdrawalAmount[]>;
};

type ClaimableWithdrawalsStorageLike = {
  listTrackedWithdrawalAddresses: () => Promise<string[]>;
  pruneUntrackedWithdrawalAddresses: () => Promise<void>;
  upsertClaimableAmounts: (amounts: ClaimableWithdrawalAmount[]) => Promise<void>;
};

type ClaimableWithdrawalsControllerParams = {
  chain: Chain;
  chunkSize?: number;
  reader: ClaimableWithdrawalsReader;
  storage: ClaimableWithdrawalsStorageLike;
};

/**
 * ClaimableWithdrawalsController refreshes Gnosis claimable withdrawal snapshots from the deposit contract.
 */
export class ClaimableWithdrawalsController {
  private readonly chunkSize: number;
  private readonly chain: Chain;
  private readonly reader: ClaimableWithdrawalsReader;
  private readonly storage: ClaimableWithdrawalsStorageLike;

  constructor(params: ClaimableWithdrawalsControllerParams) {
    this.chain = params.chain;
    this.chunkSize = params.chunkSize ?? 25;
    this.reader = params.reader;
    this.storage = params.storage;
  }

  /**
   * Refreshes claimable snapshots for tracked withdrawal addresses, doing no work outside Gnosis.
   */
  async updateClaimableSnapshots(): Promise<void> {
    if (this.chain !== 'gnosis') return;

    const withdrawalAddresses = await this.storage.listTrackedWithdrawalAddresses();
    const claimableAmounts: ClaimableWithdrawalAmount[] = [];

    for (const addressChunk of chunk(withdrawalAddresses, this.chunkSize)) {
      claimableAmounts.push(...(await this.reader.getWithdrawableAmounts(addressChunk)));
    }

    await this.storage.upsertClaimableAmounts(claimableAmounts);
    await this.storage.pruneUntrackedWithdrawalAddresses();
  }
}
