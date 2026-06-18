import { pathToFileURL } from 'url';

import { Prisma, PrismaClient } from '@beacon-indexer/db';

export const VALIDATORS_ENDPOINT_PATH = '/eth/v1/beacon/states/head/validators';
const DEFAULT_BATCH_SIZE = 10_000;

type FetchResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  json: () => Promise<unknown>;
};

type FetchImpl = (url: string) => Promise<FetchResponse>;

type RawExecutor = {
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
};

export type ValidatorWithdrawalCredentialsPrefixBackfillRow = {
  validatorIndex: number;
  withdrawalCredentialsPrefix: string;
};

export type ValidatorWithdrawalCredentialsPrefixBackfillStore = {
  updateValidatorWithdrawalCredentialsPrefixes: (
    rows: ValidatorWithdrawalCredentialsPrefixBackfillRow[],
  ) => Promise<number>;
};

type BackfillParams = {
  beaconBaseUrl: string;
  fetchImpl?: FetchImpl;
  store: ValidatorWithdrawalCredentialsPrefixBackfillStore;
};

export type ValidatorWithdrawalCredentialsPrefixBackfillCliArgs = {
  beaconBaseUrl: string;
  databaseUrl: string;
};

/**
 * Builds the Beacon API validators endpoint from an operator-provided base URL.
 */
export function buildValidatorsEndpointUrl(beaconBaseUrl: string): string {
  return new URL(VALIDATORS_ENDPOINT_PATH, beaconBaseUrl).toString();
}

/**
 * Checks whether an unknown value is a plain object for response validation.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates one Beacon API validator item before converting it into a DB row.
 */
function parseValidatorCredentialPrefixRow(
  item: unknown,
): ValidatorWithdrawalCredentialsPrefixBackfillRow {
  if (!isRecord(item) || typeof item.index !== 'string' || !isRecord(item.validator)) {
    throw new Error('Beacon validator item must include index and validator fields');
  }

  const withdrawalCredentials = item.validator.withdrawal_credentials;
  if (
    typeof withdrawalCredentials !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(withdrawalCredentials)
  ) {
    throw new Error('Beacon validator item must include 32-byte withdrawal_credentials');
  }

  const validatorIndex = Number(item.index);
  if (!Number.isSafeInteger(validatorIndex) || validatorIndex < 0) {
    throw new Error('Beacon validator item must include a non-negative integer index');
  }

  return { validatorIndex, withdrawalCredentialsPrefix: withdrawalCredentials.slice(0, 4) };
}

/**
 * Converts the Beacon API response into the minimal rows needed for backfill.
 */
function parseValidatorCredentialPrefixRows(
  response: unknown,
): ValidatorWithdrawalCredentialsPrefixBackfillRow[] {
  if (!isRecord(response) || !Array.isArray(response.data)) {
    throw new Error('Beacon validators response must include a data array');
  }

  return response.data.map(parseValidatorCredentialPrefixRow);
}

/**
 * Fetches current validator credentials prefixes and writes them through the supplied store.
 */
export async function backfillValidatorWithdrawalCredentialsPrefixes({
  beaconBaseUrl,
  fetchImpl = fetch,
  store,
}: BackfillParams): Promise<{ fetched: number; updated: number }> {
  const validatorsEndpointUrl = buildValidatorsEndpointUrl(beaconBaseUrl);
  const response = await fetchImpl(validatorsEndpointUrl);

  if (!response.ok) {
    throw new Error(
      `Beacon validators request failed with ${response.status ?? 'unknown'} ${response.statusText ?? ''}`.trim(),
    );
  }

  const rows = parseValidatorCredentialPrefixRows(await response.json());
  const updated = await store.updateValidatorWithdrawalCredentialsPrefixes(rows);

  return { fetched: rows.length, updated };
}

export class PrismaValidatorWithdrawalCredentialsPrefixBackfillStore
  implements ValidatorWithdrawalCredentialsPrefixBackfillStore
{
  constructor(
    private readonly prisma: RawExecutor,
    private readonly batchSize = DEFAULT_BATCH_SIZE,
  ) {}

  /**
   * Updates validator rows in bounded batches to avoid large SQL parameter lists.
   */
  async updateValidatorWithdrawalCredentialsPrefixes(
    rows: ValidatorWithdrawalCredentialsPrefixBackfillRow[],
  ): Promise<number> {
    let updated = 0;

    for (let offset = 0; offset < rows.length; offset += this.batchSize) {
      const batch = rows.slice(offset, offset + this.batchSize);
      updated += await this.updateBatch(batch);
    }

    return updated;
  }

  /**
   * Updates one batch by joining validator rows against an inline VALUES table.
   */
  private async updateBatch(
    rows: ValidatorWithdrawalCredentialsPrefixBackfillRow[],
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const values = rows.map(
      (row) =>
        Prisma.sql`(${row.validatorIndex}::integer, ${row.withdrawalCredentialsPrefix}::char(4))`,
    );

    return this.prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."validator" AS validator
      SET "withdrawal_credentials_prefix" = data.withdrawal_credentials_prefix
      FROM (VALUES ${Prisma.join(values)}) AS data(id, withdrawal_credentials_prefix)
      WHERE validator.id = data.id
    `);
  }
}

/**
 * Reads the required Beacon base URL and database URL CLI arguments.
 */
export function readValidatorWithdrawalCredentialsPrefixBackfillArgs(
  argv: string[],
): ValidatorWithdrawalCredentialsPrefixBackfillCliArgs {
  const beaconBaseUrl = argv[2];
  const databaseUrl = argv[3];

  if (!beaconBaseUrl || !databaseUrl) {
    throw new Error(
      'Usage: pnpm --filter indexer backfill:validator-withdrawal-credentials-prefix <beacon-base-url> <database-url>',
    );
  }

  return { beaconBaseUrl, databaseUrl };
}

/**
 * Runs the CLI backfill and prints a concise operator-facing summary.
 */
async function main(): Promise<void> {
  const { beaconBaseUrl, databaseUrl } = readValidatorWithdrawalCredentialsPrefixBackfillArgs(
    process.argv,
  );
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  try {
    const result = await backfillValidatorWithdrawalCredentialsPrefixes({
      beaconBaseUrl,
      store: new PrismaValidatorWithdrawalCredentialsPrefixBackfillStore(prisma),
    });

    console.log(
      `Backfilled validator withdrawal credentials prefixes: fetched=${result.fetched} updated=${result.updated}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
