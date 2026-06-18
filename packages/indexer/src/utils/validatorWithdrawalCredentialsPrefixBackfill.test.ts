import { describe, expect, it, vi } from 'vitest';

import {
  backfillValidatorWithdrawalCredentialsPrefixes,
  buildValidatorsEndpointUrl,
  PrismaValidatorWithdrawalCredentialsPrefixBackfillStore,
  readValidatorWithdrawalCredentialsPrefixBackfillArgs,
} from '@/scripts/backfillValidatorWithdrawalCredentialsPrefix.js';

// SAMPLE_BEACON_BASE_URL represents the operator-provided Consensus Layer base URL.
// The backfill script should append the validators endpoint instead of requiring
// callers to pass a full Beacon API route.
const SAMPLE_BEACON_BASE_URL = 'https://beacon.example.com';

// SAMPLE_DATABASE_URL represents the explicit PostgreSQL connection string
// passed to the backfill command instead of being loaded from env files.
const SAMPLE_DATABASE_URL = 'postgresql://user:password@localhost:7770/beacon?schema=public';

// VALIDATOR_WITH_EXECUTION_WITHDRAWAL represents a normal 0x01 withdrawal
// credentials payload whose 0x01 prefix identifies an execution-address withdrawal.
const VALIDATOR_WITH_EXECUTION_WITHDRAWAL =
  '0x0100000000000000000000001111111111111111111111111111111111111111';

// VALIDATOR_WITH_COMPOUNDING_WITHDRAWAL represents an Electra compounding
// credentials payload, which should store only its 0x02 prefix in the database.
const VALIDATOR_WITH_COMPOUNDING_WITHDRAWAL =
  '0x0200000000000000000000002222222222222222222222222222222222222222';

// This suite covers the standalone backfill behavior without requiring a real
// Beacon node or PostgreSQL database.
describe('validator withdrawal credentials prefix backfill', () => {
  // This scenario verifies that the CLI contract requires both the Beacon base
  // URL and the database connection string as explicit positional arguments.
  it('parses the beacon base URL and database URL from CLI args', () => {
    // Parse argv in the same position Node uses when executing a TS script.
    const args = readValidatorWithdrawalCredentialsPrefixBackfillArgs([
      'node',
      'backfillValidatorWithdrawalCredentialsPrefix.ts',
      SAMPLE_BEACON_BASE_URL,
      SAMPLE_DATABASE_URL,
    ]);

    // The backfill should use the first positional arg for Beacon reads and the
    // second positional arg for the Prisma database connection.
    expect(args).toEqual({
      beaconBaseUrl: SAMPLE_BEACON_BASE_URL,
      databaseUrl: SAMPLE_DATABASE_URL,
    });
  });

  // This scenario verifies that missing database input fails before any
  // backfill work can run against an implicit or wrong database.
  it('rejects CLI args without a database URL', () => {
    // Omit the database URL to prove the script no longer falls back to env files.
    expect(() =>
      readValidatorWithdrawalCredentialsPrefixBackfillArgs([
        'node',
        'backfillValidatorWithdrawalCredentialsPrefix.ts',
        SAMPLE_BEACON_BASE_URL,
      ]),
    ).toThrow(
      'Usage: pnpm --filter indexer backfill:validator-withdrawal-credentials-prefix <beacon-base-url> <database-url>',
    );
  });

  // This scenario verifies that operators only provide a Beacon API base URL
  // and the script appends the validators route consistently.
  it('builds the validators endpoint URL from the beacon base URL', () => {
    // Build the URL from a base URL with a trailing slash to cover the common
    // copy-paste form used in environment variables and CLI arguments.
    const url = buildValidatorsEndpointUrl(`${SAMPLE_BEACON_BASE_URL}/`);

    // The script should target the current head validator state so every row
    // receives its latest withdrawal credentials prefix.
    expect(url).toBe(`${SAMPLE_BEACON_BASE_URL}/eth/v1/beacon/states/head/validators`);
  });

  // This scenario verifies the fetch/parse/store flow using one 0x01 validator
  // and one 0x02 validator to prove only the prefixes are stored.
  it('fetches validator credential prefixes and writes them through the store', async () => {
    // The fake Beacon response includes only the fields needed for this
    // backfill, matching the real response shape at data[].validator.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            index: '1',
            validator: {
              withdrawal_credentials: VALIDATOR_WITH_EXECUTION_WITHDRAWAL,
            },
          },
          {
            index: '2',
            validator: {
              withdrawal_credentials: VALIDATOR_WITH_COMPOUNDING_WITHDRAWAL,
            },
          },
        ],
      }),
    });

    // The store records the exact rows the backfill intends to persist.
    const updateValidatorWithdrawalCredentialsPrefixes = vi.fn().mockResolvedValue(2);

    // Run the backfill with injected dependencies so the test stays deterministic.
    const result = await backfillValidatorWithdrawalCredentialsPrefixes({
      beaconBaseUrl: SAMPLE_BEACON_BASE_URL,
      fetchImpl,
      store: { updateValidatorWithdrawalCredentialsPrefixes },
    });

    // The Beacon call should use the derived validators endpoint.
    expect(fetchImpl).toHaveBeenCalledWith(
      `${SAMPLE_BEACON_BASE_URL}/eth/v1/beacon/states/head/validators`,
    );

    // The store should receive one row per validator with only the compact prefix.
    expect(updateValidatorWithdrawalCredentialsPrefixes).toHaveBeenCalledWith([
      {
        validatorIndex: 1,
        withdrawalCredentialsPrefix: '0x01',
      },
      {
        validatorIndex: 2,
        withdrawalCredentialsPrefix: '0x02',
      },
    ]);

    // The result should report both the fetched rows and rows updated by storage.
    expect(result).toEqual({ fetched: 2, updated: 2 });
  });

  // This scenario verifies that malformed Beacon responses fail before any
  // database writes, avoiding partial or misleading backfills.
  it('rejects malformed validator responses before writing rows', async () => {
    // The fake Beacon response omits data[], which means it is not a validators
    // response and should not be trusted for a backfill.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: null }),
    });

    // The store should remain unused because no valid rows can be parsed.
    const updateValidatorWithdrawalCredentialsPrefixes = vi.fn();

    // The backfill should fail with a clear message before touching storage.
    await expect(
      backfillValidatorWithdrawalCredentialsPrefixes({
        beaconBaseUrl: SAMPLE_BEACON_BASE_URL,
        fetchImpl,
        store: { updateValidatorWithdrawalCredentialsPrefixes },
      }),
    ).rejects.toThrow('Beacon validators response must include a data array');

    // No database writes should be attempted for malformed API data.
    expect(updateValidatorWithdrawalCredentialsPrefixes).not.toHaveBeenCalled();
  });

  // This scenario verifies the Prisma storage adapter updates rows in bounded
  // chunks so large validator sets do not exceed PostgreSQL bind parameter limits.
  it('updates validator credential prefixes in bounded Prisma batches', async () => {
    // The fake Prisma client reports two affected rows in the first batch and
    // one affected row in the second batch.
    const executeRaw = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    // A batch size of two forces three rows to be split across two statements.
    const store = new PrismaValidatorWithdrawalCredentialsPrefixBackfillStore(
      { $executeRaw: executeRaw },
      2,
    );

    // Update three validators so the test proves chunking, not just a single write.
    const updated = await store.updateValidatorWithdrawalCredentialsPrefixes([
      {
        validatorIndex: 1,
        withdrawalCredentialsPrefix: '0x01',
      },
      {
        validatorIndex: 2,
        withdrawalCredentialsPrefix: '0x02',
      },
      {
        validatorIndex: 3,
        withdrawalCredentialsPrefix: '0x01',
      },
    ]);

    // The adapter should execute two SQL batches and return the total affected rows.
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(updated).toBe(3);
  });
});
