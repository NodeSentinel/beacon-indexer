import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@beacon-indexer/db';

import type { Block } from '../../packages/indexer/src/services/consensus/types.js';

const START_SLOT = 11_649_024;
const END_SLOT = 14_230_799;
const BEACON_API_URL = process.env.BEACON_API_URL ?? 'https://ethereum-beacon-api.publicnode.com';
const PROGRESS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'progress.json');

type ExecutionRequests = NonNullable<Block['data']['message']['body']['execution_requests']>;

const prisma = new PrismaClient();

/**
 * Reads the next slot to process from progress.json.
 */
async function readNextSlot(): Promise<number> {
  try {
    return JSON.parse(await readFile(PROGRESS_FILE, 'utf8')) as number;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return START_SLOT;
    }

    throw error;
  }
}

/**
 * Stores only the next slot to process.
 */
async function writeNextSlot(slot: number): Promise<void> {
  await writeFile(PROGRESS_FILE, JSON.stringify(slot));
}

/**
 * Fetches the Electra execution requests for one beacon slot.
 */
async function fetchExecutionRequests(slot: number): Promise<ExecutionRequests | null> {
  const response = await fetch(`${BEACON_API_URL}/eth/v2/beacon/blocks/${slot}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`slot ${slot}: ${response.status} ${await response.text()}`);
  }

  const block = (await response.json()) as Block;
  const executionRequests = block.data.message.body.execution_requests;

  return {
    deposits: executionRequests?.deposits ?? [],
    withdrawals: executionRequests?.withdrawals ?? [],
    consolidations: executionRequests?.consolidations ?? [],
  };
}

/**
 * Inserts execution requests without updating slot processing flags.
 */
async function saveExecutionRequests(slot: number, executionRequests: ExecutionRequests) {
  if (executionRequests.deposits.length > 0) {
    await prisma.validatorDeposits.createMany({
      data: executionRequests.deposits.map((deposit) => ({
        slot,
        source: 'e',
        pubkey: deposit.pubkey,
        withdrawalCredentials: deposit.withdrawal_credentials,
        amount: BigInt(deposit.amount),
        index: Number(deposit.index),
      })),
      skipDuplicates: true,
    });
  }

  if (executionRequests.withdrawals.length > 0) {
    await prisma.validatorWithdrawalsRequests.createMany({
      data: executionRequests.withdrawals.map((withdrawal, requestIndex) => ({
        slot,
        requestIndex,
        sourceAddress: withdrawal.source_address ?? null,
        pubKey: withdrawal.validator_pubkey,
        amount: BigInt(withdrawal.amount),
      })),
      skipDuplicates: true,
    });
  }

  if (executionRequests.consolidations.length > 0) {
    await prisma.validatorConsolidationsRequests.createMany({
      data: executionRequests.consolidations.map((consolidation, requestIndex) => ({
        slot,
        requestIndex,
        sourceAddress: consolidation.source_address ?? null,
        sourcePubkey: consolidation.source_pubkey,
        targetPubkey: consolidation.target_pubkey,
      })),
      skipDuplicates: true,
    });
  }
}

/**
 * Runs the backfill sequentially and persists progress after each slot.
 */
async function main() {
  for (let slot = await readNextSlot(); slot <= END_SLOT; slot += 1) {
    const executionRequests = await fetchExecutionRequests(slot);

    if (executionRequests) {
      await saveExecutionRequests(slot, executionRequests);
    }

    await writeNextSlot(slot + 1);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
