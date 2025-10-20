import { describe, it, expect, beforeEach, vi } from 'vitest';

import { EpochStorage } from './epoch.js';
import { ValidatorsStorage } from './validators.js';

describe('EpochStorage Validation Logic', () => {
  let epochStorage: EpochStorage;

  beforeEach(() => {
    vi.clearAllMocks();

    const mockValidatorsStorage = {} as unknown as ValidatorsStorage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    epochStorage = new EpochStorage({} as unknown as any, mockValidatorsStorage);
  });

  describe('createEpochs validation', () => {
    it('should throw error for non-consecutive epochs', async () => {
      await expect(epochStorage.createEpochs([1000, 1002, 1003])).rejects.toThrow(
        'Epochs must be consecutive. Found gap between 1000 and 1002',
      );
    });

    it('should throw error for duplicate epochs in input', async () => {
      await expect(epochStorage.createEpochs([1000, 1001, 1001, 1002])).rejects.toThrow(
        'Epochs must be consecutive. Found gap between 1001 and 1001',
      );
    });
  });
});
