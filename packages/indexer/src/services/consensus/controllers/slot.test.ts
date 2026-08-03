import { describe, expect, it, vi } from 'vitest';

import { SlotController } from './slot.js';

// This suite verifies slot controller transformations before storage writes.
describe('SlotController', () => {
  // This test protects request order while delegating validator resolution to the atomic storage write.
  it('passes ordered withdrawal requests to storage for atomic resolution', async () => {
    // This pubkey represents a validator that storage will resolve during the insert.
    const knownValidatorPubkey =
      '0xa5256ce2de7b9bd44f3dc7e368d27386b1958373e7c04bcb97805bf382ecd6cd56716499f4dc625f3fab6f2cfca8fa0b';
    // This pubkey verifies the controller does not silently discard unresolved requests.
    const unknownValidatorPubkey =
      '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    // This storage mock captures the complete request list passed to the atomic database operation.
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

    // This call places a potentially unresolved request between two requests for a known validator.
    await controller.processErWithdrawals(123, [
      {
        source_address: '0x1111111111111111111111111111111111111111',
        validator_pubkey: knownValidatorPubkey,
        amount: '1',
      },
      {
        source_address: '0x2222222222222222222222222222222222222222',
        validator_pubkey: unknownValidatorPubkey,
        amount: '2',
      },
      {
        source_address: '0x3333333333333333333333333333333333333333',
        validator_pubkey: knownValidatorPubkey,
        amount: '3',
      },
    ]);

    // Storage receives every request in protocol order and is responsible for rejecting unknown pubkeys.
    expect(slotStorage.saveValidatorWithdrawalsRequests).toHaveBeenCalledWith(123, [
      {
        sourceAddress: '0x1111111111111111111111111111111111111111',
        validatorPubkey: knownValidatorPubkey,
        amount: BigInt(1),
      },
      {
        sourceAddress: '0x2222222222222222222222222222222222222222',
        validatorPubkey: unknownValidatorPubkey,
        amount: BigInt(2),
      },
      {
        sourceAddress: '0x3333333333333333333333333333333333333333',
        validatorPubkey: knownValidatorPubkey,
        amount: BigInt(3),
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

  // This test protects duplicate consolidation requests with the same source and target pubkeys.
  it('preserves execution consolidation request order and source address', async () => {
    // This storage mock returns an unprocessed slot and captures consolidation request rows.
    const slotStorage = {
      getBaseSlot: vi.fn().mockResolvedValue({
        slot: 14417443,
        erConsolidationsFetched: false,
      }),
      saveValidatorConsolidationsRequests: vi.fn().mockResolvedValue(undefined),
    };

    // This controller only needs slot storage for execution consolidation request processing.
    const controller = new SlotController(
      slotStorage as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    // This call mirrors slot 14417443: two valid consolidation requests have
    // identical source address, source pubkey, and target pubkey.
    await controller.processErConsolidations(14417443, [
      {
        source_address: '0xf692ff7984721182352ba275eae0d3f2dbaf3382',
        source_pubkey:
          '0xaf93aa9e3a10b0ff351fb9352b79cf5010bdd1755d90476ccdfec4f00882e0dcbf9d9f75db6371f97b0dbd3d982cef25',
        target_pubkey:
          '0x84c76421ffc9f8a2590acf39a46be555a0f0623629106cb326865ffb54867f33a86cbde9a7d705c723e62d8f18ce4e41',
      },
      {
        source_address: '0xf692ff7984721182352ba275eae0d3f2dbaf3382',
        source_pubkey:
          '0xaf93aa9e3a10b0ff351fb9352b79cf5010bdd1755d90476ccdfec4f00882e0dcbf9d9f75db6371f97b0dbd3d982cef25',
        target_pubkey:
          '0x84c76421ffc9f8a2590acf39a46be555a0f0623629106cb326865ffb54867f33a86cbde9a7d705c723e62d8f18ce4e41',
      },
    ]);

    // This assertion verifies identical consolidation payloads are stored as
    // separate ordered requests instead of being collapsed by pubkey identity.
    expect(slotStorage.saveValidatorConsolidationsRequests).toHaveBeenCalledWith(14417443, [
      {
        slot: 14417443,
        requestIndex: 0,
        sourceAddress: '0xf692ff7984721182352ba275eae0d3f2dbaf3382',
        sourcePubkey:
          '0xaf93aa9e3a10b0ff351fb9352b79cf5010bdd1755d90476ccdfec4f00882e0dcbf9d9f75db6371f97b0dbd3d982cef25',
        targetPubkey:
          '0x84c76421ffc9f8a2590acf39a46be555a0f0623629106cb326865ffb54867f33a86cbde9a7d705c723e62d8f18ce4e41',
      },
      {
        slot: 14417443,
        requestIndex: 1,
        sourceAddress: '0xf692ff7984721182352ba275eae0d3f2dbaf3382',
        sourcePubkey:
          '0xaf93aa9e3a10b0ff351fb9352b79cf5010bdd1755d90476ccdfec4f00882e0dcbf9d9f75db6371f97b0dbd3d982cef25',
        targetPubkey:
          '0x84c76421ffc9f8a2590acf39a46be555a0f0623629106cb326865ffb54867f33a86cbde9a7d705c723e62d8f18ce4e41',
      },
    ]);
  });
});
