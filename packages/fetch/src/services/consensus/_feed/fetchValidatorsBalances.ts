import { Prisma } from '@beacon-indexer/db';
import { Decimal } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import ms from 'ms';

import { getPrisma } from '@/src/lib/prisma.js';
import { beacon_getValidatorsBalances } from '@/src/services/consensus/_feed/endpoints.js';
import { getEpochFromSlot } from '@/src/services/consensus/utils/misc.js';
import { db_getFinalValidatorIds, db_getMaxValidatorId } from '@/src/utils/db.js';

const prisma = getPrisma();

// Function to save validator balances to database
async function saveValidatorBalancesToDatabase(
  validatorBalances: Array<{ index: string; balance: string }>,
  slot: number,
) {
  try {
    await prisma.$transaction(
      async (tx) => {
        // Create temporary table
        await tx.$executeRaw`
        CREATE TEMPORARY TABLE "TempValidator" (LIKE "Validator") ON COMMIT DROP
      `;

        const batches = chunk(validatorBalances, 12_000);
        for (const batch of batches) {
          await tx.$executeRaw`
          INSERT INTO "TempValidator" (id, balance)
          VALUES ${Prisma.join(
            batch.map(
              (data) =>
                Prisma.sql`(
                  ${parseInt(data.index)}, 
                  ${new Decimal(data.balance)}
                )`,
            ),
            ', ',
          )}
        `;
        }

        // Merge data from temporary table to main table
        await tx.$executeRaw`
          INSERT INTO "Validator" (id, balance)
          SELECT id, balance
          FROM "TempValidator"
          ON CONFLICT (id) DO UPDATE SET
            "balance" = EXCLUDED.balance
        `;

        // Update the epoch to mark balances as fetched
        await tx.epoch.update({
          where: { epoch: getEpochFromSlot(slot) },
          data: { validatorsBalancesFetched: true },
        });
      },
      {
        timeout: ms('1m'),
      },
    );
  } catch (error) {
    console.error(`Error saving validator balances to database`, error);
    throw error;
  }
}

export async function fetchValidatorsBalances(slot: number) {
  try {
    const totalValidators = await db_getMaxValidatorId();
    if (totalValidators == 0) {
      return;
    }

    const batchSize = 1_000_000;

    // Get final state validators
    const finalStateValidatorsIds = await db_getFinalValidatorIds();
    const finalStateValidatorsSet = new Set(finalStateValidatorsIds);

    // Generate all validator IDs and filter out final state validators
    const allValidatorIds = Array.from({ length: totalValidators }, (_, i) => i).filter(
      (id) => !finalStateValidatorsSet.has(id),
    );

    // Create chunks of batchSize
    const batches = chunk(allValidatorIds, batchSize);
    let allValidatorBalances: Awaited<ReturnType<typeof beacon_getValidatorsBalances>> = [];

    for (const batchIds of batches) {
      try {
        const batchResult = await beacon_getValidatorsBalances(
          slot,
          batchIds.map((id) => String(id)),
        );

        allValidatorBalances = [...allValidatorBalances, ...batchResult];

        if (batchResult.length < batchSize) {
          break;
        }
      } catch (error) {
        console.error(`Error processing batch`, error);
      }
    }

    // Save all collected data to database
    await saveValidatorBalancesToDatabase(allValidatorBalances, slot);
  } catch (error) {
    console.error(`Error fetching validator balances info`, error);
  }
}
