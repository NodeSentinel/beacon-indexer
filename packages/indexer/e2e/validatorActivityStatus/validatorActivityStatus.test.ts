import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// This suite makes sure the new validator activity fields and incident cursor table round-trip through Prisma.
describe('Validator Activity Status Schema', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    // These checks require a live PostgreSQL database, just like the other e2e suites.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    // Use the generated Prisma client so the test exercises the real schema surface.
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
  });

  afterAll(async () => {
    // Disconnect cleanly so the test process can exit without open handles.
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Remove only the rows this schema-locking test creates.
    await prisma.incidentProcessorState.deleteMany({});
    await prisma.validatorsSnapshotStats.deleteMany({});
  });

  // This scenario locks the new shared validator state columns and the processor cursor table.
  it('persists validator activity state and processor cursors', async () => {
    // Seed the validator snapshot row with the new activity tracking columns.
    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex: 101,
        status: 'active',
        isInactive: false,
        inactiveSinceSlot: null,
        activeSinceSlot: 42,
        consecutiveMissedAttestations: 0,
        lastObservedSlot: 42,
        lastAttestedSlot: 41,
        lastMissedAttestationSlot: null,
        rewardsProcessedThroughSlot: 88,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 1,
        attestationsMissed: 0,
      },
    });

    // Seed the incident processor cursor using the new dedicated state table.
    await prisma.incidentProcessorState.create({
      data: {
        processor: 'incident-tracker',
        lastProcessedSlot: 9001,
      },
    });

    // Read the snapshot row back to confirm Prisma sees the new columns as first-class fields.
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: 101 },
    });

    // Read the processor state back to confirm the model maps to the expected table.
    const processorState = await prisma.incidentProcessorState.findUniqueOrThrow({
      where: { processor: 'incident-tracker' },
    });

    expect(snapshot.consecutiveMissedAttestations).toBe(0);
    expect(snapshot.lastObservedSlot).toBe(42);
    expect(snapshot.lastAttestedSlot).toBe(41);
    expect(snapshot.lastMissedAttestationSlot).toBeNull();
    expect(snapshot.rewardsProcessedThroughSlot).toBe(88);
    expect(processorState.lastProcessedSlot).toBe(9001);
  });
});
