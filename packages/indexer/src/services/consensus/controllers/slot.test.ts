import { describe, expect, it, vi } from 'vitest';

import { SlotController } from './slot.js';

// This suite verifies slot controller transformations before storage writes.
describe('SlotController', () => {
  // This test protects duplicate withdrawal requests for the same validator in one slot.
  it('preserves execution withdrawal request order and source address', async () => {
    // This storage mock returns the base slot and captures withdrawal request rows.
    const slotStorage = {
      getBaseSlot: vi.fn().mockResolvedValue({
        slot: 123,
        erWithdrawalsFetched: false,
      }),
      saveValidatorWithdrawalsRequests: vi.fn().mockResolvedValue(undefined),
    };

    // This controller only needs slot storage for execution withdrawal request processing.
    const controller = new SlotController(
      slotStorage as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    // This call uses two requests for the same validator pubkey in the same slot.
    await controller.processErWithdrawals(123, [
      {
        source_address: '0x1111111111111111111111111111111111111111',
        validator_pubkey:
          '0xa5256ce2de7b9bd44f3dc7e368d27386b1958373e7c04bcb97805bf382ecd6cd56716499f4dc625f3fab6f2cfca8fa0b',
        amount: '1',
      },
      {
        source_address: '0x2222222222222222222222222222222222222222',
        validator_pubkey:
          '0xa5256ce2de7b9bd44f3dc7e368d27386b1958373e7c04bcb97805bf382ecd6cd56716499f4dc625f3fab6f2cfca8fa0b',
        amount: '2',
      },
    ]);

    // This assertion verifies duplicate pubkeys are kept as separate ordered rows.
    expect(slotStorage.saveValidatorWithdrawalsRequests).toHaveBeenCalledWith(123, [
      {
        slot: 123,
        requestIndex: 0,
        sourceAddress: '0x1111111111111111111111111111111111111111',
        pubKey:
          '0xa5256ce2de7b9bd44f3dc7e368d27386b1958373e7c04bcb97805bf382ecd6cd56716499f4dc625f3fab6f2cfca8fa0b',
        amount: BigInt(1),
      },
      {
        slot: 123,
        requestIndex: 1,
        sourceAddress: '0x2222222222222222222222222222222222222222',
        pubKey:
          '0xa5256ce2de7b9bd44f3dc7e368d27386b1958373e7c04bcb97805bf382ecd6cd56716499f4dc625f3fab6f2cfca8fa0b',
        amount: BigInt(2),
      },
    ]);
  });

  // This test verifies beacon body deposits get a source-local index because the
  // Beacon API body deposit payload has no protocol deposit index.
  it('stores body deposits with data source and positional index', async () => {
    // This storage mock returns an unprocessed slot and captures body deposit rows.
    const slotStorage = {
      getBaseSlot: vi.fn().mockResolvedValue({
        slot: 456,
        depositsFetched: false,
      }),
      saveBodyDeposits: vi.fn().mockResolvedValue(undefined),
    };

    // This controller only needs slot storage for body deposit processing.
    const controller = new SlotController(
      slotStorage as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    // This call uses two body deposits in one slot; their order is the only
    // source-local identity available for body deposits in the block response.
    await controller.processDeposits(456, [
      {
        proof: [],
        data: {
          pubkey:
            '0x95bfbd34770dcf14d605342f8141ff54c5737af55edd3034dd3bc3beecef5c610b38860de24e2de99a179ad61d535bdb',
          withdrawal_credentials:
            '0x010000000000000000000000d1e0bfc4b19c8310b71ae202dc7cb96a8733aebc',
          amount: '32000000000',
          signature: '0x01',
        },
      },
      {
        proof: [],
        data: {
          pubkey:
            '0xa1202e8dec943df62a030f6d8226393c9914d12d6a03edfbeac2979326f63daa104bc6aacbffb39747db0552497065a4',
          withdrawal_credentials:
            '0x010000000000000000000000d1e0bfc4b19c8310b71ae202dc7cb96a8733aebc',
          amount: '32000000000',
          signature: '0x02',
        },
      },
    ]);

    // This assertion verifies body deposits are uniquely identified inside their
    // slot by source plus response position, without relying on pubkey uniqueness.
    expect(slotStorage.saveBodyDeposits).toHaveBeenCalledWith(456, [
      {
        slot: 456,
        source: 'd',
        pubkey:
          '0x95bfbd34770dcf14d605342f8141ff54c5737af55edd3034dd3bc3beecef5c610b38860de24e2de99a179ad61d535bdb',
        withdrawalCredentials: '0x010000000000000000000000d1e0bfc4b19c8310b71ae202dc7cb96a8733aebc',
        amount: BigInt('32000000000'),
        index: 0,
      },
      {
        slot: 456,
        source: 'd',
        pubkey:
          '0xa1202e8dec943df62a030f6d8226393c9914d12d6a03edfbeac2979326f63daa104bc6aacbffb39747db0552497065a4',
        withdrawalCredentials: '0x010000000000000000000000d1e0bfc4b19c8310b71ae202dc7cb96a8733aebc',
        amount: BigInt('32000000000'),
        index: 1,
      },
    ]);
  });

  // This test protects repeated execution request deposit pubkeys in one slot.
  it('stores execution request deposits with data source and request index', async () => {
    // This storage mock returns an unprocessed slot and captures execution request deposits.
    const slotStorage = {
      getBaseSlot: vi.fn().mockResolvedValue({
        slot: 789,
        erDepositsFetched: false,
      }),
      saveValidatorDeposits: vi.fn().mockResolvedValue(undefined),
    };

    // This controller only needs slot storage for execution request deposit processing.
    const controller = new SlotController(
      slotStorage as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    // This call mirrors slot 14366232: two request deposits share one pubkey but
    // carry different request indexes and amounts.
    await controller.processErDeposits(789, [
      {
        pubkey:
          '0x81e4e336806f73d993b2148a3421f2bcf54bef9f358410826aec4833634d34da88bb57610f0d645a4cf8b3ffff2f77af',
        withdrawal_credentials:
          '0x02000000000000000000000085122eae301063fe709f8ae2411ef1a89e40a73e',
        amount: '1100000000',
        signature: '0x01',
        index: '2479367',
      },
      {
        pubkey:
          '0x81e4e336806f73d993b2148a3421f2bcf54bef9f358410826aec4833634d34da88bb57610f0d645a4cf8b3ffff2f77af',
        withdrawal_credentials:
          '0x02000000000000000000000085122eae301063fe709f8ae2411ef1a89e40a73e',
        amount: '2500000000',
        signature: '0x02',
        index: '2479368',
      },
    ]);

    // This assertion verifies duplicate pubkeys are stored as separate request rows.
    expect(slotStorage.saveValidatorDeposits).toHaveBeenCalledWith(789, [
      {
        slot: 789,
        source: 'e',
        pubkey:
          '0x81e4e336806f73d993b2148a3421f2bcf54bef9f358410826aec4833634d34da88bb57610f0d645a4cf8b3ffff2f77af',
        withdrawalCredentials: '0x02000000000000000000000085122eae301063fe709f8ae2411ef1a89e40a73e',
        index: 2479367,
        amount: BigInt('1100000000'),
      },
      {
        slot: 789,
        source: 'e',
        pubkey:
          '0x81e4e336806f73d993b2148a3421f2bcf54bef9f358410826aec4833634d34da88bb57610f0d645a4cf8b3ffff2f77af',
        withdrawalCredentials: '0x02000000000000000000000085122eae301063fe709f8ae2411ef1a89e40a73e',
        index: 2479368,
        amount: BigInt('2500000000'),
      },
    ]);
  });
});
