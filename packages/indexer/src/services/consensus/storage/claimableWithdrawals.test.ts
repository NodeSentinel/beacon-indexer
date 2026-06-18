import { describe, expect, it, vi } from 'vitest';

import { ClaimableWithdrawalsStorage } from './claimableWithdrawals.js';

/**
 * Extracts SQL text from a Prisma.sql object used by raw storage operations.
 */
function getSqlText(queryArg: unknown): string {
  if (queryArg && typeof queryArg === 'object' && 'sql' in queryArg) {
    return (queryArg as { sql: string }).sql;
  }

  return '';
}

describe('ClaimableWithdrawalsStorage', () => {
  // This suite verifies claimable snapshot pruning stays database-side and parameter-safe.
  it('prunes stale claimable snapshots with a database-side tracked-address subquery', async () => {
    // This scenario keeps pruning scalable when the tracked withdrawal address set grows large.
    const executeRaw = vi.fn().mockResolvedValue(undefined);
    const storage = new ClaimableWithdrawalsStorage({ $executeRaw: executeRaw } as never);

    // Runs pruning without passing a potentially large tracked address array through query params.
    await storage.pruneUntrackedWithdrawalAddresses();

    // Confirms the delete computes tracked withdrawal addresses inside PostgreSQL.
    const sql = getSqlText(executeRaw.mock.calls[0]?.[0]);
    expect(sql).toContain('DELETE FROM withdrawal_address_claimable_snapshot');
    expect(sql).toContain('SELECT DISTINCT LOWER(v.withdrawal_address)');
    expect(sql).toContain('JOIN validator v ON v.id = cv.validator_index');
    // Confirms pruning does not bind one parameter per tracked address.
    expect(executeRaw.mock.calls[0]?.[0].values).toEqual([]);
  });
});
