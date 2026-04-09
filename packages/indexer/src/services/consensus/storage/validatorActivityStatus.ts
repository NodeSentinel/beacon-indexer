import { Prisma, PrismaClient } from '@beacon-indexer/db';

import { getActivityLookbackSlots } from './activityLookback.js';
import { IncidentStorage } from './incident.js';

type SyncCurrentActivityStatusParams = {
  // Last slot whose attestation outcome is old enough to be judged final for the
  // current activity snapshot. Newer slots may still receive valid inclusions.
  safeObservedSlot: number;
  // Minimum trailing missed-attestation streak required to mark a validator as
  // currently inactive in the fast snapshot.
  inactiveMissedCount: number;
  // Largest attestation delay still considered successful before a duty counts
  // as missed for the current activity streak.
  maxAttestationDelay: number;
};

type DutyRow = {
  validator_index: number;
  slot: number;
  attestation_delay: number | null;
};

type SnapshotSeedRow = {
  validatorIndex: number;
  isInactive: boolean;
  inactiveSinceSlot: number | null;
  activeSinceSlot: number | null;
  consecutiveMissedAttestations: number;
  lastAttestedSlot: number | null;
  lastMissedAttestationSlot: number | null;
};

type ValidatorTransition = {
  validatorIndex: number;
  isInactive: boolean;
  transitionSlot: number;
};

type NextSnapshotState = {
  validatorIndex: number;
  isInactive: boolean;
  inactiveSinceSlot: number | null;
  activeSinceSlot: number | null;
  consecutiveMissedAttestations: number;
  lastAttestedSlot: number | null;
  lastMissedAttestationSlot: number | null;
};

const VALIDATOR_ACTIVITY_PROCESSOR = 'validator-activity-status';

/**
 * Owns the fast-path snapshot columns that reflect current validator activity
 * and now also advances the authoritative incident-reconciliation cursor.
 */
export class ValidatorActivityStatusStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly incidentStorage: IncidentStorage,
    private readonly slotsPerEpoch: number,
  ) {}

  private isMissedDuty(duty: DutyRow, maxAttestationDelay: number): boolean {
    return duty.attestation_delay === null || duty.attestation_delay > maxAttestationDelay;
  }

  private async loadTouchedValidatorMemberships(
    tx: Prisma.TransactionClient,
    validatorIndexes: number[],
  ) {
    if (validatorIndexes.length === 0) {
      return [];
    }

    // Read cluster memberships only for validators whose inactive/active flag
    // changed in this batch so incident reconciliation stays tightly scoped.
    return tx.$queryRaw<Array<{ cluster_id: string; validator_index: number }>>`
      SELECT cv.cluster_id, cv.validator_index
      FROM cluster_validator cv
      WHERE cv.validator_index = ANY(${validatorIndexes}::int[])
    `;
  }

  async syncCurrentActivityStatus(params: SyncCurrentActivityStatusParams): Promise<void> {
    const { safeObservedSlot, inactiveMissedCount, maxAttestationDelay } = params;
    const lookbackSlots = getActivityLookbackSlots(this.slotsPerEpoch, inactiveMissedCount);

    await this.prisma.$transaction(async (tx) => {
      // Keep a durable cursor so each run processes only the duties that became
      // newly safe since the previous successful activity pass.
      const processorState = await tx.incidentProcessorState.upsert({
        where: { processor: VALIDATOR_ACTIVITY_PROCESSOR },
        update: {},
        create: {
          processor: VALIDATOR_ACTIVITY_PROCESSOR,
          lastProcessedSlot: Math.max(safeObservedSlot - lookbackSlots - 1, -1),
        },
      });

      const lowerExclusiveSlot = Math.max(
        processorState.lastProcessedSlot,
        safeObservedSlot - lookbackSlots - 1,
      );

      if (lowerExclusiveSlot >= safeObservedSlot) {
        return;
      }

      // Load only the duties that became newly safe for the activity pipeline.
      const duties = await tx.$queryRaw<DutyRow[]>`
        SELECT
          c.validator_index,
          c.slot,
          c.attestation_delay
        FROM committee c
        WHERE c.slot > ${lowerExclusiveSlot}::int
          AND c.slot <= ${safeObservedSlot}::int
        ORDER BY c.validator_index ASC, c.slot ASC
      `;

      const touchedValidatorIndexes = [...new Set(duties.map((duty) => duty.validator_index))];

      // Advance the durable cursor even when no new duties became safe.
      if (touchedValidatorIndexes.length === 0) {
        await tx.incidentProcessorState.update({
          where: { processor: VALIDATOR_ACTIVITY_PROCESSOR },
          data: { lastProcessedSlot: safeObservedSlot },
        });
        return;
      }

      // Seed the incremental transition logic from the current authoritative
      // snapshot state for only the validators touched by the new duties.
      const seedRows = await tx.validatorsSnapshotStats.findMany({
        where: {
          validatorIndex: {
            in: touchedValidatorIndexes,
          },
        },
        select: {
          validatorIndex: true,
          isInactive: true,
          inactiveSinceSlot: true,
          activeSinceSlot: true,
          consecutiveMissedAttestations: true,
          lastAttestedSlot: true,
          lastMissedAttestationSlot: true,
        },
      });

      const seedByValidator = new Map<number, SnapshotSeedRow>(
        seedRows.map((row) => [row.validatorIndex, row]),
      );
      const dutiesByValidator = new Map<number, DutyRow[]>();
      for (const duty of duties) {
        const validatorDuties = dutiesByValidator.get(duty.validator_index) ?? [];
        validatorDuties.push(duty);
        dutiesByValidator.set(duty.validator_index, validatorDuties);
      }

      const nextStates: NextSnapshotState[] = [];
      const transitions: ValidatorTransition[] = [];

      // Replay only the newly safe duties for each touched validator, starting
      // from the current snapshot row that already reflects earlier safe slots.
      for (const validatorIndex of touchedValidatorIndexes) {
        const seed = seedByValidator.get(validatorIndex);
        if (!seed) {
          continue;
        }

        let isInactive = seed.isInactive;
        let inactiveSinceSlot = seed.inactiveSinceSlot;
        let activeSinceSlot = seed.activeSinceSlot;
        let consecutiveMissedAttestations = seed.consecutiveMissedAttestations;
        let lastAttestedSlot = seed.lastAttestedSlot;
        const lastMissedAttestationSlot = seed.lastMissedAttestationSlot;
        const validatorDuties = dutiesByValidator.get(validatorIndex) ?? [];
        for (const duty of validatorDuties) {
          const wasInactive = isInactive;

          if (this.isMissedDuty(duty, maxAttestationDelay)) {
            // Start a new missed-duty streak from this slot only when the prior
            // consecutive streak was empty.
            if (consecutiveMissedAttestations === 0) {
              inactiveSinceSlot = duty.slot;
            }

            consecutiveMissedAttestations += 1;
            lastAttestedSlot = null;

            if (consecutiveMissedAttestations >= inactiveMissedCount) {
              isInactive = true;

              if (!wasInactive && inactiveSinceSlot !== null) {
                transitions.push({
                  validatorIndex,
                  isInactive: true,
                  transitionSlot: inactiveSinceSlot,
                });
              }
            }
          } else {
            // Any successful duty resets the missed streak and closes the
            // inactivity period immediately on that attested slot.
            consecutiveMissedAttestations = 0;
            isInactive = false;
            inactiveSinceSlot = null;
            activeSinceSlot = duty.slot;
            lastAttestedSlot = duty.slot;

            if (wasInactive) {
              transitions.push({
                validatorIndex,
                isInactive: false,
                transitionSlot: duty.slot,
              });
            }
          }
        }

        // Preserve the existing "current window only" contract for
        // lastAttestedSlot by deriving it from the newest successful duty that
        // appeared in this newly safe batch.
        const lastSuccessfulDuty = [...validatorDuties]
          .reverse()
          .find((duty) => !this.isMissedDuty(duty, maxAttestationDelay));

        if (lastSuccessfulDuty) {
          lastAttestedSlot = lastSuccessfulDuty.slot;
        } else if (validatorDuties.length > 0) {
          lastAttestedSlot = null;
        }

        nextStates.push({
          validatorIndex,
          isInactive,
          inactiveSinceSlot: isInactive ? inactiveSinceSlot : null,
          activeSinceSlot,
          consecutiveMissedAttestations,
          lastAttestedSlot,
          lastMissedAttestationSlot,
        });
      }

      // Update only the validators touched by newly safe duties instead of
      // rewriting the full snapshot table each time.
      for (const nextState of nextStates) {
        await tx.validatorsSnapshotStats.update({
          where: { validatorIndex: nextState.validatorIndex },
          data: {
            isInactive: nextState.isInactive,
            inactiveSinceSlot: nextState.inactiveSinceSlot,
            activeSinceSlot: nextState.activeSinceSlot,
            consecutiveMissedAttestations: nextState.consecutiveMissedAttestations,
            lastAttestedSlot: nextState.lastAttestedSlot,
            lastMissedAttestationSlot: nextState.lastMissedAttestationSlot,
          },
        });
      }

      const memberships = await this.loadTouchedValidatorMemberships(tx, [
        ...new Set(transitions.map((transition) => transition.validatorIndex)),
      ]);

      const membershipsByValidator = new Map<number, string[]>();
      for (const membership of memberships) {
        const validatorMemberships = membershipsByValidator.get(membership.validator_index) ?? [];
        validatorMemberships.push(membership.cluster_id);
        membershipsByValidator.set(membership.validator_index, validatorMemberships);
      }

      // Reconcile incidents from the exact validator transitions produced by the
      // activity replay so open/close slots stay aligned with snapshot state.
      for (const transition of transitions) {
        for (const clusterId of membershipsByValidator.get(transition.validatorIndex) ?? []) {
          await this.incidentStorage.reconcileOpenIncident(tx, {
            clusterId,
            slot: transition.transitionSlot,
            additions: transition.isInactive ? [transition.validatorIndex] : [],
            removals: transition.isInactive ? [] : [transition.validatorIndex],
          });
        }
      }

      // Persist the new safe boundary only after both snapshot rows and cluster
      // incidents have been reconciled successfully in the same transaction.
      await tx.incidentProcessorState.update({
        where: { processor: VALIDATOR_ACTIVITY_PROCESSOR },
        data: { lastProcessedSlot: safeObservedSlot },
      });
    });
  }
}
