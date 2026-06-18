import { describe, expect, it, vi } from 'vitest';

import { ValidatorStorage } from './validator.js';

describe('ValidatorStorage.getStakeDistributionByWithdrawalAddress', () => {
  it('groups validators by withdrawal address before assigning stake buckets', async () => {
    // This case protects the monetization distribution query from counting validators as addresses.
    const queryRaw = vi.fn().mockResolvedValue([]);
    const storage = new ValidatorStorage({ $queryRaw: queryRaw } as never);

    // Executes the method so the Prisma tagged SQL is constructed through real code.
    await storage.getStakeDistributionByWithdrawalAddress({
      gweiPerTokenMultiplier: 32,
      tokenSymbol: 'GNO',
    });

    // Reads the raw SQL template sent to Prisma for structural assertions.
    const sql = Array.from(queryRaw.mock.calls[0]?.[0] ?? []).join('?');

    // Confirms withdrawal addresses are made unique before bucket assignment.
    expect(sql).toContain('GROUP BY withdrawal_address');
    // Confirms the query buckets by raw gwei so chain-specific formatting stays outside storage.
    expect(sql).toContain('total_effective_gwei');
    // Confirms the query receives chain-specific token labels and threshold multiplier as parameters.
    expect(queryRaw.mock.calls[0]).toContain('<640 GNO');
    expect(queryRaw.mock.calls[0]).toContain('640-3,200 GNO');
    expect(queryRaw.mock.calls[0]).toContain('>=32,000 GNO');
    expect(queryRaw.mock.calls[0]).toContain(32);
  });
});
