import { PrismaClient } from '@beacon-indexer/db';

/**
 * Owns the fast-path snapshot columns that reflect current validator activity.
 * Historical lifecycle fields remain outside this storage's responsibility.
 */
export class ValidatorActivityStatusStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async syncCurrentActivityStatus(params: {
    safeObservedSlot: number;
    maxAttestationDelay: number;
  }): Promise<void> {
    const { safeObservedSlot, maxAttestationDelay } = params;

    const newDuties = await this.prisma.$queryRaw<
      Array<{
        validator_index: number;
        slot: number;
        attestation_delay: number | null;
      }>
    >`
      SELECT
        vss.validator_index,
        c.slot,
        c.attestation_delay
      FROM validators_snapshot_stats vss
      JOIN committee c ON c.validator_index = vss.validator_index
      WHERE c.slot <= ${safeObservedSlot}::int
        AND c.slot > COALESCE(vss.last_observed_slot, -1)
      ORDER BY vss.validator_index ASC, c.slot ASC
    `;

    if (newDuties.length === 0) {
      return;
    }

    const snapshots = await this.prisma.validatorsSnapshotStats.findMany({
      where: {
        validatorIndex: {
          in: [...new Set(newDuties.map((duty) => duty.validator_index))],
        },
      },
      select: {
        validatorIndex: true,
        consecutiveMissedAttestations: true,
        currentMissedStreakStartSlot: true,
        lastObservedSlot: true,
        lastAttestedSlot: true,
        lastMissedAttestationSlot: true,
      },
    });

    const snapshotByValidator = new Map(
      snapshots.map((snapshot) => [snapshot.validatorIndex, snapshot] as const),
    );
    const updates = new Map<
      number,
      {
        consecutiveMissedAttestations: number;
        currentMissedStreakStartSlot: number | null;
        lastObservedSlot: number | null;
        lastAttestedSlot: number | null;
        lastMissedAttestationSlot: number | null;
      }
    >();

    for (const duty of newDuties) {
      const current =
        updates.get(duty.validator_index) ??
        (() => {
          const snapshot = snapshotByValidator.get(duty.validator_index);
          if (!snapshot) {
            throw new Error(`Missing snapshot row for validator ${duty.validator_index}`);
          }

          return {
            consecutiveMissedAttestations: snapshot.consecutiveMissedAttestations,
            currentMissedStreakStartSlot: snapshot.currentMissedStreakStartSlot,
            lastObservedSlot: snapshot.lastObservedSlot,
            lastAttestedSlot: snapshot.lastAttestedSlot,
            lastMissedAttestationSlot: snapshot.lastMissedAttestationSlot,
          };
        })();

      const isMissed =
        duty.attestation_delay === null || duty.attestation_delay > maxAttestationDelay;

      current.lastObservedSlot = duty.slot;

      if (isMissed) {
        if (current.consecutiveMissedAttestations === 0) {
          current.currentMissedStreakStartSlot = duty.slot;
        }
        current.consecutiveMissedAttestations += 1;
        current.lastMissedAttestationSlot = duty.slot;
      } else {
        current.consecutiveMissedAttestations = 0;
        current.currentMissedStreakStartSlot = null;
        current.lastAttestedSlot = duty.slot;
      }

      updates.set(duty.validator_index, current);
    }

    await this.prisma.$transaction(
      [...updates.entries()].map(([validatorIndex, update]) =>
        this.prisma.validatorsSnapshotStats.update({
          where: { validatorIndex },
          data: {
            consecutiveMissedAttestations: update.consecutiveMissedAttestations,
            currentMissedStreakStartSlot: update.currentMissedStreakStartSlot,
            lastObservedSlot: update.lastObservedSlot,
            lastAttestedSlot: update.lastAttestedSlot,
            lastMissedAttestationSlot: update.lastMissedAttestationSlot,
            updatedAt: new Date(),
          },
        }),
      ),
    );
  }
}
