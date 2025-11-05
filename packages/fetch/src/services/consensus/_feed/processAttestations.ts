import { Prisma } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import ms from 'ms';

import { getPrisma } from '@/src/lib/prisma.js';
import { Attestation } from '@/src/services/consensus/types.js';
import {
  convertVariableBitsToString,
  convertFixedBitsToString,
  convertHexStringToByteArray,
} from '@/src/services/consensus/utils/bitlist.js';
import { getOldestLookbackSlot } from '@/src/services/consensus/utils/misc.js';

interface CommitteeUpdate {
  slot: number;
  index: number;
  //validatorIndex: number;
  aggregationBitsIndex: number;
  attestationDelay: number;
}

const prisma = getPrisma();

export const processAttestations = async (
  slotNumber: number,
  allAttestations: Attestation[],
  slotCommitteesValidatorsAmounts: Record<number, number[]>,
) => {
  // Filter out attestations that are older than the oldest lookback slot
  // This is important to handle the base case for which we won't have epoch, committee, etc.
  const filteredAttestations = allAttestations.filter(
    (attestation) => +attestation.data.slot >= getOldestLookbackSlot(),
  );

  // The beacon request brings attestations for different slots.
  // we need to process each of them and calculate the delay for each attestation.
  const attestations: CommitteeUpdate[] = [];
  for (const attestation of filteredAttestations) {
    const updates = await processAttestation(
      slotNumber,
      attestation,
      slotCommitteesValidatorsAmounts,
    );
    attestations.push(...updates);
  }

  // remove duplicates
  const uniqueAttestations = new Map<string, CommitteeUpdate>();
  for (const attestation of attestations) {
    const key = `${attestation.slot}-${attestation.index}-${attestation.aggregationBitsIndex}`;
    const existing = uniqueAttestations.get(key);

    if (!existing || attestation.attestationDelay < existing.attestationDelay) {
      uniqueAttestations.set(key, attestation);
    }
  }
  const deduplicatedAttestations = Array.from(uniqueAttestations.values());

  // Update committee table
  await persistToDB(deduplicatedAttestations, slotNumber);
};

async function processAttestation(
  slotNumber: number,
  attestation: Attestation,
  slotCommitteesValidatorsAmounts: Record<number, number[]>,
) {
  const attestationSlot = Number(attestation.data.slot);

  // aggregation_bits come in a hexadecimal format. we convert it to a binary string.
  // each bit represents if the validator on a committee attested or not. First bit represents the first validator in the committee.
  const aggregationBits = convertVariableBitsToString(
    convertHexStringToByteArray(attestation.aggregation_bits),
  );

  // committee_bits also comes in a hexadecimal format. we convert it to a binary string.
  // each bit represents if the bits bring data for a committee or not.
  const committeeBits = convertFixedBitsToString(
    convertHexStringToByteArray(attestation.committee_bits),
  );

  // we need to know how many validators are in the committee for the slot.
  // so we can extract the correct bits from the aggregation_bits.
  const slotCommitteeValidatorsAmount = slotCommitteesValidatorsAmounts[attestationSlot];
  if (!slotCommitteeValidatorsAmount) {
    throw `No validator count found for slot ${attestationSlot}`;
  }

  const updates: CommitteeUpdate[] = [];

  // Process each committee
  let currentAggregationIndex = 0;
  for (let committeeBit = 0; committeeBit < committeeBits.length; committeeBit++) {
    const validatorsInCommittee = slotCommitteeValidatorsAmount[committeeBit];

    // Only process committees that contributed to aggregation_bits
    if (committeeBits[committeeBit] === '1') {
      // Get the section of aggregation_bits for this committee
      const committeeAggregationBits = aggregationBits.slice(
        currentAggregationIndex,
        currentAggregationIndex + validatorsInCommittee,
      );

      // Process each validator's attestation in this committee
      for (let i = 0; i < committeeAggregationBits.length; i++) {
        if (committeeAggregationBits[i] === '1') {
          const attestationDelay = slotNumber - attestationSlot - 1;
          const attestationInfo = {
            slot: attestationSlot,
            index: committeeBit,
            aggregationBitsIndex: i,
            attestationDelay,
          };

          updates.push(attestationInfo);
        }
      }

      // Only increment the index if we processed this committee
      currentAggregationIndex += validatorsInCommittee;
    }
  }

  return updates;
}

async function persistToDB(attestations: CommitteeUpdate[], slotNumber: number): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const queries: Prisma.Sql[] = [];

      // Process updates
      if (attestations.length > 0) {
        const updateChunks = chunk(attestations, 7000);
        for (const batchUpdates of updateChunks) {
          const updateQuery = Prisma.sql`
            UPDATE "Committee" c
            SET "attestationDelay" = v.delay
            FROM (VALUES
              ${Prisma.join(
                batchUpdates.map(
                  (u) =>
                    Prisma.sql`(${u.slot}, ${u.index}, ${u.aggregationBitsIndex}, ${u.attestationDelay})`,
                ),
              )}
            ) AS v(slot, index, "aggregationBitsIndex", delay)
            WHERE c.slot = v.slot 
              AND c.index = v.index 
              AND c."aggregationBitsIndex" = v."aggregationBitsIndex"
              AND (c."attestationDelay" IS NULL OR c."attestationDelay" > v.delay);
          `;
          queries.push(updateQuery);
        }
      }

      // Execute all queries in parallel
      await Promise.all(queries.map((query) => tx.$executeRaw(query)));

      // Update slot processing data
      await tx.slot.upsert({
        where: { slot: slotNumber },
        update: { attestationsFetched: true },
        create: {
          slot: slotNumber,
          attestationsFetched: true,
        },
      });
    },
    { timeout: ms('1m') },
  );
}
