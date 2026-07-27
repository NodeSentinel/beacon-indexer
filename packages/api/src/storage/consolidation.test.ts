import { describe, expect, it, vi } from 'vitest';

import { ConsolidationStorage } from './consolidation.js';

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

describe('ConsolidationStorage.getConsolidations', () => {
  // This suite verifies cluster-scoped consolidation listings include source-side and target-side matches once.
  it('filters by either consolidation side without duplicating rows when both validators are in the cluster', async () => {
    // This case models a cluster that may contain only the source validator, only the target validator, or both validators.
    const queryRaw = vi.fn().mockResolvedValue([]);
    const storage = new ConsolidationStorage({ $queryRaw: queryRaw } as never);

    // Executes the method so the Prisma tagged SQL is built by the real storage code.
    await storage.getConsolidations({ clusterId: 'cluster-a', page: 1, pageSize: 10 });

    // Reads the raw SQL template to verify the cluster predicate checks both consolidation participants.
    const sql = getSqlText(queryRaw.mock.calls[0]?.[0]);

    // Confirms target pubkeys are resolved so target-only cluster membership can match.
    expect(sql).toContain(
      'LEFT JOIN validator target_validator ON target_validator.pubkey = c.target_pubkey',
    );
    // Confirms the membership predicate accepts either the source or target validator index.
    expect(sql).toContain('cv.validator_index IN (source_validator.id, target_validator.id)');
    // Confirms membership is tested with EXISTS instead of a row-producing join, preventing duplicate output rows.
    expect(sql).toContain('WHERE EXISTS');
    expect(sql).not.toContain(
      'JOIN cluster_validator cv ON cv.validator_index = source_validator.id',
    );
  });
});
