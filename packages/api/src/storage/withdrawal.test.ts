import { describe, expect, it, vi } from 'vitest';

import { PayoutStorage } from './payout.js';
import { WithdrawalStorage } from './withdrawal.js';

/**
 * Extracts SQL text from Prisma tagged-template calls for storage query assertions.
 */
function getSqlText(queryArg: unknown): string {
  if (Array.isArray(queryArg)) return Array.from(queryArg).join('?');
  if (queryArg && typeof queryArg === 'object' && 'strings' in queryArg) {
    return Array.from((queryArg as { strings: string[] }).strings).join('?');
  }
  if (queryArg && typeof queryArg === 'object' && 'sql' in queryArg) {
    return (queryArg as { sql: string }).sql;
  }
  return '';
}

// This suite protects the domain boundary between completed payouts and operator withdrawal requests.
describe('payout and withdrawal storage', () => {
  // This scenario expects the payouts listing to read completed execution-payload withdrawals only.
  it('queries validator withdrawals without including withdrawal requests for payouts', async () => {
    // The empty result keeps the assertion focused on the SQL source selected for cluster payouts.
    const queryRaw = vi.fn().mockResolvedValue([]);
    const storage = new PayoutStorage({ $queryRaw: queryRaw } as never);

    // A first-page cluster query builds the real Prisma tagged template with a ten-row page.
    await storage.getPayouts({ clusterId: 'cluster-a', page: 1, pageSize: 10 });

    // The emitted SQL must use completed withdrawals and must not join the EIP-7002 request table.
    const sql = getSqlText(queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain('FROM validator_withdrawals w');
    expect(sql).not.toContain('validator_request_withdrawals');
  });

  // This scenario expects the withdrawals listing to read EIP-7002 operator requests only.
  it('queries withdrawal requests without including completed payouts', async () => {
    // The empty result keeps the assertion focused on the SQL source selected for operator requests.
    const queryRaw = vi.fn().mockResolvedValue([]);
    const storage = new WithdrawalStorage({ $queryRaw: queryRaw } as never);

    // A first-page cluster query builds the real Prisma tagged template with a ten-row page.
    await storage.getWithdrawals({ clusterId: 'cluster-a', page: 1, pageSize: 10 });

    // The emitted SQL must use the request table and must not union completed payout rows.
    const sql = getSqlText(queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain('FROM validator_request_withdrawals wr');
    expect(sql).not.toContain('FROM validator_withdrawals w');
    expect(sql).not.toContain('UNION ALL');
  });
});
