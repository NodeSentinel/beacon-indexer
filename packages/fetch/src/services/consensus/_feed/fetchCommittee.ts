import chunk from 'lodash/chunk.js';
import ms from 'ms';

import { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { beacon_getCommittees } from '@/src/services/consensus/_feed/endpoints.js';
import { getOldestLookbackSlot } from '@/src/services/consensus/utils/misc.js';

type Committee = {
  slot: string;
  index: string;
  validators: string[];
};

type CommitteeUpsert = {
  slot: number;
  index: number;
  aggregationBitsIndex: number;
  validatorIndex: number;
};

const prisma = getPrisma();

// function logCommitteeInfo(
//   logger: CustomLogger,
//   fetchedCommittees: Array<{
//     slot: string;
//     index: string;
//     validators: string[];
//   }>,
//   slotUpserts: number[],
// ): void {
//   // Filter committees to match the new slots
//   const filteredCommittees = fetchedCommittees.filter((c) => slotUpserts.includes(+c.slot));

//   const groupedCommittees = filteredCommittees.reduce(
//     (acc, committee) => {
//       if (!acc[committee.slot]) {
//         acc[committee.slot] = [];
//       }
//       acc[committee.slot]!.push(+committee.index);
//       return acc;
//     },
//     {} as Record<string, number[]>,
//   );

//   const logMessage = Object.entries(groupedCommittees)
//     .map(([slot, indexes]) => `${slot}:${indexes.length}`)
//     .join(',');

//   logger.info(`New slots [${slotUpserts}] - Committees: ${logMessage || 'null'}`);
// }

// New function to handle parallel fetching
export async function fetchCommittee(
  epochToFetch: number,
  //lastSlot: number,
): Promise<void> {
  const committees = await beacon_getCommittees(epochToFetch);
  const preparedData = await prepareUpsertData(committees);
  //logCommitteeInfo(logger, committees, preparedData.newSlots);
  await saveCommittee(epochToFetch, preparedData.newSlots, preparedData.newCommittees);
}

async function prepareUpsertData(committees: Committee[]) {
  const oldestLookbackSlot = getOldestLookbackSlot();

  const uniqueSlots = Array.from(new Set(committees.map((c) => +c.slot)));
  const newSlots = uniqueSlots.filter((slot) => Number(slot) >= oldestLookbackSlot);

  // all the committees that will be inserted into the Committee table.
  const newCommittees: CommitteeUpsert[] = [];
  committees.forEach((committee) => {
    const slot = +committee.slot;

    if (slot < oldestLookbackSlot) {
      return;
    }

    committee.validators.forEach((validatorIndex, index) => {
      newCommittees.push({
        slot,
        index: +committee.index, // index within the slot
        aggregationBitsIndex: index, // position in the validators array (indexOf)
        validatorIndex: +validatorIndex,
      });
    });
  });

  if (newSlots.length === 0 || newCommittees.length === 0) {
    throw new Error('No new slots or committees to save');
  }

  return {
    newSlots,
    newCommittees,
  };
}

async function saveCommittee(epoch: number, slots: number[], committees: CommitteeUpsert[]) {
  // we need to save on the Slot table the number of validators in each committee.
  const validatorsInCommitteePerSlot = new Map<number, number[]>();
  for (const u of committees) {
    if (!validatorsInCommitteePerSlot.has(u.slot)) {
      validatorsInCommitteePerSlot.set(u.slot, []);
    }
    const validatorsInSlot = validatorsInCommitteePerSlot.get(u.slot)!;
    validatorsInSlot[u.index] = (validatorsInSlot[u.index] || 0) + 1;
  }

  await prisma.$transaction(
    async (tx) => {
      // Single bulk INSERT with ON CONFLICT - equivalent to original performance
      await tx.$executeRaw`
        INSERT INTO "Slot" (slot, "attestationsProcessed", "committeeValidatorCounts")
        SELECT 
          unnest(${slots}::integer[]), 
          false,
          unnest(${slots.map((slot) => JSON.stringify(validatorsInCommitteePerSlot.get(slot) || []))}::jsonb[])
        ON CONFLICT (slot) DO UPDATE SET
          "committeeValidatorCounts" = EXCLUDED."committeeValidatorCounts"
      `;

      // Insert committees in batches for better performance
      const batchSize = 100000;
      const batches = chunk(committees, batchSize);
      for (const batch of batches) {
        await tx.committee.createMany({
          data: batch,
        });
      }

      // Update epoch status
      await tx.epoch.update({
        where: { epoch },
        data: { committeesFetched: true },
      });
    },
    {
      timeout: ms('5m'),
    },
  );
}
