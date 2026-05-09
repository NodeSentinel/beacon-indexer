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
});
