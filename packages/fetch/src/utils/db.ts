import { Prisma, LastSummaryUpdate } from '@beacon-indexer/db';

import { getPrisma } from '@/src/lib/prisma.js';
import { VALIDATOR_STATUS } from '@/src/services/consensus/constants.js';
const prisma = getPrisma();

export const db_getLastSlotWithAttestations = async () =>
  await prisma.slot.findFirst({
    where: { attestationsFetched: true },
    orderBy: { slot: 'desc' },
    select: { slot: true },
  });

export const db_getSlotByNumber = async (slot: number) =>
  prisma.slot.findFirst({
    where: { slot },
    select: {
      slot: true,
      attestationsFetched: true,
      //committees: true,
    },
  });

export const db_hasEpochCommittees = async (epoch: number) => {
  const res = await prisma.epoch.findFirst({
    where: { epoch, committeesFetched: true },
  });
  return res !== null;
};

export const db_getLastSlotWithSyncRewards = async () =>
  await prisma.slot.findFirst({
    where: {
      AND: [{ consensusRewardsFetched: true }, { syncRewardsFetched: true }],
    },
    orderBy: { slot: 'desc' },
    select: { slot: true },
  });

export const db_areValidatorsFetched = async () => {
  const res = await prisma.validator.findFirst();
  return res !== null;
};

export const db_getLastEpochWithCommittees = async () =>
  prisma.epoch.findFirst({
    where: { committeesFetched: true },
    orderBy: { epoch: 'desc' },
    select: { epoch: true },
  });

export const db_upsertEpoch = async (epoch: number) =>
  prisma.epoch.upsert({
    where: { epoch },
    create: { epoch, rewardsFetched: false },
    update: {},
  });

/**
 * Gets the committee validator counts for multiple slots
 * @param slotNumbers Array of slot numbers to check
 * @returns An object where keys are slot numbers and values are committee validator counts
 */
export async function db_getSlotCommitteesValidatorsAmountsForSlots(slotNumbers: number[]) {
  if (slotNumbers.length === 0) {
    return {};
  }

  const slots = await prisma.slot.findMany({
    where: {
      slot: {
        in: slotNumbers,
      },
    },
    select: {
      slot: true,
      committeesCountInSlot: true,
    },
    orderBy: {
      slot: 'desc',
    },
  });

  return slots.reduce(
    (acc, slot) => {
      acc[slot.slot] = slot.committeesCountInSlot as number[];
      return acc;
    },
    {} as Record<number, number[]>,
  );
}

export async function updateLastSummaryUpdate<K extends keyof LastSummaryUpdate>(
  key: K,
  value: LastSummaryUpdate[K],
  tx?: Prisma.TransactionClient,
) {
  const client = tx || prisma;

  await client.lastSummaryUpdate.upsert({
    where: { id: 1 },
    update: { [key]: value },
    create: {
      id: 1,
      hourlyValidatorStats: key === 'hourlyValidatorStats' ? (value as Date) : null,
      dailyValidatorStats: key === 'dailyValidatorStats' ? (value as Date) : null,
      weeklyValidatorStats: key === 'weeklyValidatorStats' ? (value as Date) : null,
      monthlyValidatorStats: key === 'monthlyValidatorStats' ? (value as Date) : null,
      yearlyValidatorStats: key === 'yearlyValidatorStats' ? (value as Date) : null,
    },
  });
}

export async function db_getMaxValidatorId() {
  const res = await prisma.validator.findFirst({
    orderBy: { id: 'desc' },
    select: { id: true },
  });

  return res?.id ?? 0;
}

export async function db_getFinalValidatorIds(): Promise<number[]> {
  const finalStateValidators = await prisma.validator.findMany({
    where: {
      status: {
        in: [
          VALIDATOR_STATUS.exited_unslashed,
          VALIDATOR_STATUS.exited_slashed,
          VALIDATOR_STATUS.withdrawal_done,
        ],
      },
    },
    select: { id: true },
  });

  return finalStateValidators.map((v) => v.id);
}

export async function db_getValidatorsBalances(validatorIds: number[]) {
  return prisma.validator.findMany({
    where: {
      id: { in: validatorIds },
    },
    select: { id: true, balance: true },
  });
}

export async function db_getAttestingValidatorsIds(): Promise<number[]> {
  const validators = await prisma.validator.findMany({
    where: {
      OR: [
        {
          status: {
            in: [VALIDATOR_STATUS.active_ongoing, VALIDATOR_STATUS.active_exiting],
          },
        },
        {
          status: null,
        },
      ],
    },
    select: { id: true },
  });

  return validators.map((v) => v.id);
}

export async function db_getLastProcessedSyncCommittee() {
  return prisma.syncCommittee.findFirst({
    orderBy: {
      fromEpoch: 'desc',
    },
  });
}

/**
 * Gets flattened validators from a sync committee that contains the given epoch
 * @param epoch The epoch to check
 * @returns A flattened array of validator indices if found, null otherwise
 */
export async function db_getSyncCommitteeValidators(epoch: number): Promise<string[] | null> {
  const committee = await prisma.syncCommittee.findFirst({
    where: {
      fromEpoch: {
        lte: epoch,
      },
      toEpoch: {
        gte: epoch,
      },
    },
  });

  if (!committee) {
    return null;
  }

  // Flatten both validators and validatorAggregates arrays
  const validators = committee.validators as string[];
  const aggregateValidators = (committee.validatorAggregates as string[][]).flat();

  // Combine and remove duplicates
  return [...new Set([...validators, ...aggregateValidators])];
}

/**
 * Checks if beacon rewards have been fetched for a specific epoch
 */
export async function db_hasBeaconRewardsFetched(epoch: number): Promise<boolean> {
  const beaconRewards = await prisma.epoch.findUnique({
    where: {
      epoch,
      rewardsFetched: true,
    },
  });
  return beaconRewards !== null;
}

/**
 * Checks if block and sync rewards have been fetched for a specific slot
 */
export async function db_hasBlockAndSyncRewardsFetched(slot: number): Promise<boolean> {
  const slotData = await prisma.slot.findFirst({
    where: {
      slot,
      AND: [{ consensusRewardsFetched: true }, { syncRewardsFetched: true }],
    },
  });
  return slotData !== null;
}

/**
 * Counts the number of unique hours available in HourlyValidatorStats after a specific date
 */
export async function db_countRemainingHoursAfterDate(date: Date): Promise<number> {
  const remainingHours = await prisma.hourlyValidatorStats.groupBy({
    by: ['datetime'],
    where: {
      datetime: {
        gt: date,
      },
    },
  });
  return remainingHours.length;
}
