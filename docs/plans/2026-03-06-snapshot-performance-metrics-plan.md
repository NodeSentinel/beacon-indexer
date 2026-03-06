# Validators Snapshot - Performance Metrics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the validators snapshot with performance metrics (performance ratio, APY, rewards) across 1h/1d/1w/1m timeframes, with a new XState machine, API endpoint, webapp table, and e2e tests for inactivity detection.

**Architecture:** A single new `snapshotMachine` ticks every `slotDuration`, evaluating in-memory counters to decide what to update. The `SnapshotController` delegates to `SnapshotStorage` which uses raw SQL with `INSERT ... ON CONFLICT DO UPDATE` to update only the relevant columns per update level. The API exposes aggregated snapshot data per cluster, consumed by a new Performance Table component.

**Tech Stack:** Prisma (schema/migrations), XState v5 (machine), raw SQL (storage), oRPC (API), TanStack Query + React (webapp)

**Design doc:** `docs/plans/2026-03-06-snapshot-performance-metrics-design.md`

---

## Task 1: DB Schema Migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (lines 369-380, the `ValidatorsSnapshotStats` model)

**Step 1: Update the Prisma schema**

Replace the current `ValidatorsSnapshotStats` model with:

```prisma
model ValidatorsSnapshotStats {
  validatorIndex                Int      @id @map("validator_index")

  // State
  status                        String   @map("status") @db.VarChar(10)
  isInactive                    Boolean  @default(false) @map("is_inactive")
  consecutiveMissedAttestations Int      @default(0) @map("consecutive_missed_attestations")

  // Balances
  balance          BigInt @map("balance")
  effectiveBalance BigInt @map("effective_balance")
  beaconStatus     Int?   @map("beacon_status")

  // Attestations (updated per slot)
  attestationsTotal  Int @map("attestations_total")
  attestationsMissed Int @map("attestations_missed")

  // Performance per timeframe (ratio 0.0000 - 1.0000)
  performance1h Decimal? @map("performance_1h") @db.Decimal(5, 4)
  performance1d Decimal? @map("performance_1d") @db.Decimal(5, 4)
  performance1w Decimal? @map("performance_1w") @db.Decimal(5, 4)
  performance1m Decimal? @map("performance_1m") @db.Decimal(5, 4)

  // APY per timeframe
  apy1h Decimal? @map("apy_1h") @db.Decimal(5, 2)
  apy1d Decimal? @map("apy_1d") @db.Decimal(5, 2)
  apy1w Decimal? @map("apy_1w") @db.Decimal(5, 2)
  apy1m Decimal? @map("apy_1m") @db.Decimal(5, 2)

  // Consensus rewards per timeframe
  consensusReward1h BigInt? @map("consensus_reward_1h")
  consensusReward1d BigInt? @map("consensus_reward_1d")
  consensusReward1w BigInt? @map("consensus_reward_1w")
  consensusReward1m BigInt? @map("consensus_reward_1m")

  // Missed rewards per timeframe
  missedReward1h BigInt? @map("missed_reward_1h")
  missedReward1d BigInt? @map("missed_reward_1d")
  missedReward1w BigInt? @map("missed_reward_1w")
  missedReward1m BigInt? @map("missed_reward_1m")

  // Execution rewards per timeframe
  executionReward1h Decimal? @map("execution_reward_1h") @db.Decimal(78, 0)
  executionReward1d Decimal? @map("execution_reward_1d") @db.Decimal(78, 0)
  executionReward1w Decimal? @map("execution_reward_1w") @db.Decimal(78, 0)
  executionReward1m Decimal? @map("execution_reward_1m") @db.Decimal(78, 0)

  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamp

  @@map("validators_snapshot_stats")
}
```

**Step 2: Generate and review migration**

```bash
cd packages/db && pnpm prisma migrate dev --name rename-snapshot-add-performance-fields
```

This will generate a migration that:

- Renames the table from `validators_status_summary` to `validators_snapshot_stats`
- Drops the old `performance` column (Decimal 5,2)
- Adds `is_inactive`, `consecutive_missed_attestations`, `effective_balance`
- Adds all performance/APY/rewards columns per timeframe

**Important:** Review the generated SQL. Prisma may try to drop and recreate the table instead of renaming. If so, manually edit the migration SQL to use `ALTER TABLE ... RENAME TO ...` and individual `ALTER TABLE ... ADD COLUMN` / `ALTER TABLE ... DROP COLUMN` statements.

**Step 3: Generate Prisma client**

```bash
cd packages/db && pnpm prisma generate
```

**Step 4: Verify type-check passes**

```bash
pnpm type-check
```

Expected: May fail in files referencing old column names — that's expected and will be fixed in subsequent tasks.

**Step 5: Commit**

```bash
git add packages/db/
git commit -m "feat(db): rename snapshot table and add performance metric fields"
```

---

## Task 2: Rename SummaryStorage → SnapshotStorage + Refactor to UPSERT

**Files:**

- Rename: `packages/indexer/src/services/consensus/storage/summary.ts` → `packages/indexer/src/services/consensus/storage/snapshot.ts`
- Test: `packages/indexer/e2e/snapshot/snapshot.test.ts` (new)

**Step 1: Rename file and class**

Rename the file from `summary.ts` to `snapshot.ts`. Update class name from `SummaryStorage` to `SnapshotStorage`.

**Step 2: Refactor the SQL query**

The current query uses `TRUNCATE TABLE validators_status_summary` + `INSERT`. Refactor to:

1. Update table name from `validators_status_summary` to `validators_snapshot_stats`
2. Change to `INSERT ... ON CONFLICT (validator_index) DO UPDATE SET ...` so that updating attestation columns doesn't wipe performance columns
3. Add new columns: `is_inactive`, `consecutive_missed_attestations`, `effective_balance`
4. Remove old `performance` column from the query

The method `validatorsStatusSummary` should be renamed to `updateAttestationsAndStatus`. The refactored SQL should:

- Keep the same CTE structure (`user_validators`, `attestations`, `status_attestations`, `status`)
- Add a CTE to compute `consecutive_missed_attestations` by counting the longest tail of consecutive misses
- Add `is_inactive` as a boolean derived from status
- Use `ON CONFLICT (validator_index) DO UPDATE` to only update attestation/status columns

```sql
INSERT INTO validators_snapshot_stats (
  validator_index, status, is_inactive, consecutive_missed_attestations,
  attestations_total, attestations_missed, beacon_status, balance, effective_balance, updated_at
)
SELECT ... FROM summary_data
ON CONFLICT (validator_index) DO UPDATE SET
  status = EXCLUDED.status,
  is_inactive = EXCLUDED.is_inactive,
  consecutive_missed_attestations = EXCLUDED.consecutive_missed_attestations,
  attestations_total = EXCLUDED.attestations_total,
  attestations_missed = EXCLUDED.attestations_missed,
  beacon_status = EXCLUDED.beacon_status,
  balance = EXCLUDED.balance,
  effective_balance = EXCLUDED.effective_balance,
  updated_at = EXCLUDED.updated_at
```

**Step 3: Add `updateBalances` method**

Simple query that updates `balance`, `effective_balance`, and `beacon_status` from the `validator` table for all validators in `validators_snapshot_stats`:

```sql
UPDATE validators_snapshot_stats vss
SET
  balance = v.balance,
  effective_balance = v.effective_balance,
  beacon_status = v.status,
  updated_at = NOW()
FROM validator v
WHERE vss.validator_index = v.id
```

**Step 4: Add stub methods for performance updates**

Add empty methods that will be implemented in Task 4:

- `updatePerformance1h(params)`
- `updatePerformance1d(params)`
- `updatePerformance1w(params)`
- `updatePerformance1m(params)`

Each takes relevant parameters and returns `Promise<void>`.

**Step 5: Verify type-check**

```bash
pnpm type-check
```

**Step 6: Commit**

```bash
git add packages/indexer/src/services/consensus/storage/
git commit -m "refactor(indexer): rename SummaryStorage to SnapshotStorage, refactor to UPSERT"
```

---

## Task 3: Rename SummaryController → SnapshotController

**Files:**

- Rename: `packages/indexer/src/services/consensus/controllers/summary.ts` → `packages/indexer/src/services/consensus/controllers/snapshot.ts`

**Step 1: Rename file and class**

Rename from `SummaryController` to `SnapshotController`. Update the import from `SummaryStorage` to `SnapshotStorage`.

**Step 2: Rename method**

Rename `getValidatorInactivityStatus` → `updateAttestationsAndStatus`. Keep the same parameter signature and logic.

**Step 3: Add `updateBalances` method**

```typescript
async updateBalances() {
  try {
    await this.snapshotStorage.updateBalances();
    this.logger.info('Updated validator balances in snapshot');
  } catch (error) {
    this.logger.error('Error updating validator balances', error);
    throw error;
  }
}
```

**Step 4: Add stub methods for performance**

Add empty async methods that call the corresponding storage methods:

- `updatePerformance1h()`
- `updatePerformance1d()`
- `updatePerformance1w()`
- `updatePerformance1m()`

**Step 5: Verify type-check**

```bash
pnpm type-check
```

**Step 6: Commit**

```bash
git add packages/indexer/src/services/consensus/controllers/
git commit -m "refactor(indexer): rename SummaryController to SnapshotController"
```

---

## Task 4: E2E Tests for Inactivity Detection

**Files:**

- Create: `packages/indexer/e2e/snapshot/snapshot.test.ts`

**Context:** This is the most critical test in the epic. It validates that the inactivity detection logic correctly accounts for slot processing state and attestation delay windows.

**Key config values (from `packages/beacon-utils/src/config/chain.ts` — Gnosis):**

- `slotsPerEpoch`: 16
- `maxAttestationDelay`: 5
- `delaySlotsToHead`: 3
- `missedAttestationsForInactivity`: 3

**Key concept:** A validator assigned to attest at slot S can only be evaluated as "missed" after slot `S + maxAttestationDelay` has been processed. Before that, the attestation might still arrive with an acceptable delay.

**Step 1: Write the test file**

Follow the pattern from `packages/indexer/e2e/chainStats/chainStats.test.ts`:

```typescript
import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { SnapshotStorage } from '@/src/services/consensus/storage/snapshot.js';

describe('Snapshot - Inactivity Detection', () => {
  let prisma: PrismaClient;
  let snapshotStorage: SnapshotStorage;
  let snapshotController: SnapshotController;
  let beaconTime: BeaconTime;

  const LOOKBACK_SLOT = 0;
  const MAX_ATTESTATION_DELAY = gnosisConfig.beacon.maxAttestationDelay; // 5
  const DELAY_SLOTS_TO_HEAD = gnosisConfig.beacon.delaySlotsToHead; // 3
  const MISSED_FOR_INACTIVITY = gnosisConfig.beacon.missedAttestationsForInactivity; // 3
  const SLOTS_PER_EPOCH = gnosisConfig.beacon.slotsPerEpoch; // 16

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  });

  beforeEach(async () => {
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: SLOTS_PER_EPOCH,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: LOOKBACK_SLOT,
    });

    snapshotStorage = new SnapshotStorage(prisma);
    snapshotController = new SnapshotController(snapshotStorage, beaconTime);

    // Clean tables
    await prisma.$executeRawUnsafe(`DELETE FROM "validators_snapshot_stats"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "committee"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "cluster_validator"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "cluster"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "user"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "validator"`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Helper: create a user, cluster, and register validators
  async function setupValidatorsInCluster(validatorIds: number[]) {
    await prisma.user.create({ data: { id: BigInt(1), telegramId: '123' } });
    const cluster = await prisma.cluster.create({
      data: { name: 'test', ownerId: BigInt(1), visibility: 'private' },
    });
    for (const id of validatorIds) {
      await prisma.validator.upsert({
        where: { id },
        create: {
          id,
          status: 2,
          balance: BigInt(32000000000),
          effectiveBalance: BigInt(32000000000),
        },
        update: {},
      });
      await prisma.clusterValidator.create({
        data: { clusterId: cluster.id, validatorIndex: id },
      });
    }
  }

  // Helper: insert a committee row (attestation)
  async function insertAttestation(
    validatorIndex: number,
    slot: number,
    delay: number | null,
    index = 0,
    aggIndex = 0,
  ) {
    await prisma.$executeRaw`
      INSERT INTO committee (slot, index, validator_index, aggregation_bits_index, attestation_delay)
      VALUES (${slot}, ${index}, ${validatorIndex}, ${aggIndex}, ${delay})
    `;
  }

  // ... test cases below
});
```

**Step 2: Test case — Active validator (attests on-time)**

```typescript
it('should mark validator as active when attesting on-time', async () => {
  await setupValidatorsInCluster([1]);

  // Validator 1 attests at slots 100, 116, 132 with delay=1 (within maxAttestationDelay=5)
  await insertAttestation(1, 100, 1, 0, 0);
  await insertAttestation(1, 116, 2, 1, 0);
  await insertAttestation(1, 132, 1, 2, 0);

  await snapshotController.updateAttestationsAndStatus({
    slotsPerEpoch: SLOTS_PER_EPOCH,
    maxAttestationDelay: MAX_ATTESTATION_DELAY,
    delaySlotsToHead: DELAY_SLOTS_TO_HEAD,
    missedAttestationsForInactivity: MISSED_FOR_INACTIVITY,
  });

  const row = await prisma.$queryRaw<any[]>`
    SELECT * FROM validators_snapshot_stats WHERE validator_index = 1
  `;
  expect(row[0].status).toBe('active');
  expect(row[0].is_inactive).toBe(false);
});
```

**Step 3: Test case — Inactive validator (misses N consecutive)**

```typescript
it('should mark validator as inactive when missing N consecutive attestations', async () => {
  await setupValidatorsInCluster([1]);

  // Validator 1 has 3 attestations all with delay=null (missed)
  // These slots must be within the queryable range
  await insertAttestation(1, 100, null, 0, 0);
  await insertAttestation(1, 116, null, 1, 0);
  await insertAttestation(1, 132, null, 2, 0);

  await snapshotController.updateAttestationsAndStatus({
    slotsPerEpoch: SLOTS_PER_EPOCH,
    maxAttestationDelay: MAX_ATTESTATION_DELAY,
    delaySlotsToHead: DELAY_SLOTS_TO_HEAD,
    missedAttestationsForInactivity: MISSED_FOR_INACTIVITY,
  });

  const row = await prisma.$queryRaw<any[]>`
    SELECT * FROM validators_snapshot_stats WHERE validator_index = 1
  `;
  expect(row[0].status).toBe('inactive');
  expect(row[0].is_inactive).toBe(true);
  expect(row[0].consecutive_missed_attestations).toBeGreaterThanOrEqual(3);
});
```

**Step 4: Test case — Slot not yet processed**

The key edge case: validator assigned to slot 5, but indexer has only processed up to slot 3. The validator must NOT be counted as missed because the slot hasn't been processed yet.

This test verifies that the `maxQueryableSlot` calculation (`currentSlot - delaySlotsToHead - missedAttestationsForInactivity`) correctly excludes unprocessed slots.

**Step 5: Test case — Within delay window**

Validator assigned to slot 5, maxAttestationDelay=5. Indexer processed up to slot 8. Slot 5+5=10 hasn't been reached yet, so we can't say it's missed — attestation could still arrive at slots 6-10.

**Step 6: Test case — Past delay window**

Validator assigned to slot 5, maxAttestationDelay=5. Indexer processed up to slot 11. Slot 5+5=10 < 11, so the window has passed. If attestation_delay is null, it's definitively missed.

**Step 7: Test case — Recovery**

First run with missed attestations → inactive. Then add on-time attestations and re-run → should change to active.

**Step 8: Test case — Null attestation delay counts as missed**

```typescript
it('should count null attestation_delay as missed', async () => {
  await setupValidatorsInCluster([1]);
  await insertAttestation(1, 100, null, 0, 0);

  await snapshotController.updateAttestationsAndStatus({ ... });

  const row = await prisma.$queryRaw<any[]>`
    SELECT * FROM validators_snapshot_stats WHERE validator_index = 1
  `;
  expect(Number(row[0].attestations_missed)).toBe(1);
});
```

**Step 9: Run the tests**

```bash
cd packages/indexer && pnpm test:e2e
```

Expected: All 7 test cases pass.

**Step 10: Commit**

```bash
git add packages/indexer/e2e/snapshot/
git commit -m "test(indexer): add e2e tests for snapshot inactivity detection"
```

---

## Task 5: Snapshot XState Machine

**Files:**

- Create: `packages/indexer/src/xstate/snapshot/snapshot.machine.ts`
- Create: `packages/indexer/src/xstate/snapshot/index.ts`

**Step 1: Create the snapshot machine**

The machine uses a timer-based tick pattern (different from the event-driven archive machines). It ticks every `slotDuration` and evaluates what needs updating.

```typescript
// packages/indexer/src/xstate/snapshot/snapshot.machine.ts
import { setup, fromPromise, assign } from 'xstate';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

type SnapshotContext = {
  snapshotController: SnapshotController;
  slotDuration: number;
  slotsPerEpoch: number;
  maxAttestationDelay: number;
  delaySlotsToHead: number;
  missedAttestationsForInactivity: number;
  // In-memory tracking
  lastProcessedSlot: number | null;
  lastEpochUpdate: number | null;
  last1dUpdate: number | null;
  last1wUpdate: number | null;
  last1mUpdate: number | null;
};

type TickResult = {
  updatedLevels: string[];
  lastProcessedSlot: number | null;
  lastEpochUpdate: number | null;
  last1dUpdate: number | null;
  last1wUpdate: number | null;
  last1mUpdate: number | null;
};

export const snapshotMachine = setup({
  types: {} as {
    context: SnapshotContext;
    input: {
      snapshotController: SnapshotController;
      slotDuration: number;
      slotsPerEpoch: number;
      maxAttestationDelay: number;
      delaySlotsToHead: number;
      missedAttestationsForInactivity: number;
    };
  },
  delays: {
    slotDuration: ({ context }) => context.slotDuration,
  },
  actors: {
    runTick: fromPromise(async ({ input }: { input: { context: SnapshotContext } }) => {
      const ctx = input.context;
      const controller = ctx.snapshotController;
      const now = Date.now();
      const updatedLevels: string[] = [];

      let lastProcessedSlot = ctx.lastProcessedSlot;
      let lastEpochUpdate = ctx.lastEpochUpdate;
      let last1dUpdate = ctx.last1dUpdate;
      let last1wUpdate = ctx.last1wUpdate;
      let last1mUpdate = ctx.last1mUpdate;

      // Level 1: Attestations (every tick if new slot processed)
      // The controller internally checks current processed slot
      await controller.updateAttestationsAndStatus({
        slotsPerEpoch: ctx.slotsPerEpoch,
        maxAttestationDelay: ctx.maxAttestationDelay,
        delaySlotsToHead: ctx.delaySlotsToHead,
        missedAttestationsForInactivity: ctx.missedAttestationsForInactivity,
      });
      updatedLevels.push('attestations');

      // Level 2: Balances (every epoch — check if new epoch)
      // TODO: detect current epoch from beaconTime and compare with lastEpochUpdate
      // For now, update balances on every tick (low cost query)
      if (lastEpochUpdate === null) {
        await controller.updateBalances();
        lastEpochUpdate = 0; // Will be properly tracked
        updatedLevels.push('balances');
      }

      // Level 3: 1h performance (every epoch)
      // Same trigger as balances
      if (lastEpochUpdate !== null) {
        // await controller.updatePerformance1h();
        // updatedLevels.push('1h');
      }

      // Level 4: 1d performance (every 30 min)
      if (last1dUpdate === null || now - last1dUpdate > 30 * 60 * 1000) {
        // await controller.updatePerformance1d();
        last1dUpdate = now;
        // updatedLevels.push('1d');
      }

      // Level 5: 1w performance (every 3h)
      if (last1wUpdate === null || now - last1wUpdate > 3 * 60 * 60 * 1000) {
        // await controller.updatePerformance1w();
        last1wUpdate = now;
        // updatedLevels.push('1w');
      }

      // Level 6: 1m performance (every 6h)
      if (last1mUpdate === null || now - last1mUpdate > 6 * 60 * 60 * 1000) {
        // await controller.updatePerformance1m();
        last1mUpdate = now;
        // updatedLevels.push('1m');
      }

      return {
        updatedLevels,
        lastProcessedSlot,
        lastEpochUpdate,
        last1dUpdate,
        last1wUpdate,
        last1mUpdate,
      } satisfies TickResult;
    }),
  },
}).createMachine({
  id: 'Snapshot',
  initial: 'waiting',
  context: ({ input }) => ({
    snapshotController: input.snapshotController,
    slotDuration: input.slotDuration,
    slotsPerEpoch: input.slotsPerEpoch,
    maxAttestationDelay: input.maxAttestationDelay,
    delaySlotsToHead: input.delaySlotsToHead,
    missedAttestationsForInactivity: input.missedAttestationsForInactivity,
    lastProcessedSlot: null,
    lastEpochUpdate: null,
    last1dUpdate: null,
    last1wUpdate: null,
    last1mUpdate: null,
  }),
  states: {
    waiting: {
      after: {
        slotDuration: {
          target: 'ticking',
          actions: [pinoLog(() => 'Snapshot tick starting', 'Snapshot', 'debug')],
        },
      },
    },
    ticking: {
      invoke: {
        src: 'runTick',
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'waiting',
          actions: [
            assign({
              lastProcessedSlot: ({ event }) => event.output.lastProcessedSlot,
              lastEpochUpdate: ({ event }) => event.output.lastEpochUpdate,
              last1dUpdate: ({ event }) => event.output.last1dUpdate,
              last1wUpdate: ({ event }) => event.output.last1wUpdate,
              last1mUpdate: ({ event }) => event.output.last1mUpdate,
            }),
            pinoLog(({ event }) => {
              const levels = event.output.updatedLevels;
              return levels.length > 0
                ? `Snapshot tick completed: updated [${levels.join(', ')}]`
                : 'Snapshot tick completed: nothing to update';
            }, 'Snapshot'),
          ],
        },
        onError: {
          target: 'waiting',
          actions: [
            pinoLog(({ event }) => `Snapshot tick error: ${event.error}`, 'Snapshot', 'error'),
          ],
        },
      },
    },
  },
});
```

**Step 2: Create the actor factory**

```typescript
// packages/indexer/src/xstate/snapshot/index.ts
import { createActor } from 'xstate';

import { snapshotMachine } from './snapshot.machine.js';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { snapshotMachine } from './snapshot.machine.js';

export const getSnapshotActor = (
  snapshotController: SnapshotController,
  slotDuration: number,
  slotsPerEpoch: number,
  maxAttestationDelay: number,
  delaySlotsToHead: number,
  missedAttestationsForInactivity: number,
) => {
  const actor = createActor(snapshotMachine, {
    input: {
      snapshotController,
      slotDuration,
      slotsPerEpoch,
      maxAttestationDelay,
      delaySlotsToHead,
      missedAttestationsForInactivity,
    },
  });

  actor.subscribe((snapshot) => {
    logMachine('snapshot', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
```

**Step 3: Verify type-check**

```bash
pnpm type-check
```

**Step 4: Commit**

```bash
git add packages/indexer/src/xstate/snapshot/
git commit -m "feat(indexer): add snapshot XState machine with timer-based ticking"
```

---

## Task 6: Wire Snapshot Machine into Indexer Init

**Files:**

- Modify: `packages/indexer/src/xstate/index.ts`
- Modify: `packages/indexer/src/index.ts`

**Step 1: Update `packages/indexer/src/xstate/index.ts`**

Add imports for `getSnapshotActor` and `SnapshotController`. Add the snapshot actor creation and startup.

The snapshot machine runs independently (not triggered by `EPOCH_PROCESSED`), so it doesn't need to be passed to the epoch orchestrator. Just create it and start it.

Add parameters to `initXstateMachines`:

- `snapshotController: SnapshotController`
- `maxAttestationDelay: number`
- `delaySlotsToHead: number`
- `missedAttestationsForInactivity: number`

Add at the end of the function:

```typescript
// Create and start snapshot actor (runs independently with its own timer)
const snapshotActor = getSnapshotActor(
  snapshotController,
  slotDuration,
  slotsPerEpoch,
  maxAttestationDelay,
  delaySlotsToHead,
  missedAttestationsForInactivity,
);
snapshotActor.start();
```

**Step 2: Update `packages/indexer/src/index.ts`**

Add imports for `SnapshotController` and `SnapshotStorage`. Create them and pass to `initXstateMachines`.

After the chain stats controller creation (~line 198), add:

```typescript
// Create snapshot storage and controller
const snapshotStorage = new SnapshotStorage(prisma);
const snapshotController = new SnapshotController(snapshotStorage, beaconTime);
```

Update the `initXstateMachines` call to include the new parameters:

```typescript
initXstateMachines(
  // ... existing params ...
  chainStatsController,
  snapshotController,
  chainConfig.beacon.maxAttestationDelay,
  chainConfig.beacon.delaySlotsToHead,
  chainConfig.beacon.missedAttestationsForInactivity,
);
```

**Step 3: Verify type-check**

```bash
pnpm type-check
```

**Step 4: Commit**

```bash
git add packages/indexer/src/xstate/index.ts packages/indexer/src/index.ts
git commit -m "feat(indexer): wire snapshot machine into indexer initialization"
```

---

## Task 7: Performance Storage Methods (1h from raw data)

**Files:**

- Modify: `packages/indexer/src/services/consensus/storage/snapshot.ts`

**Step 1: Implement `updatePerformance1h`**

This method queries raw `committee` and `epoch_rewards` tables for the last hour to compute:

- `performance_1h`: ratio of on-time attestations
- `apy_1h`: `(consensus_rewards / balance) * 8766` (hours per year)
- `consensus_reward_1h`: sum of consensus rewards
- `missed_reward_1h`: sum of missed rewards
- `execution_reward_1h`: sum of execution rewards (from slots where validator was proposer)

```typescript
async updatePerformance1h(params: {
  minSlot: number;
  maxSlot: number;
  maxAttestationDelay: number;
}): Promise<void> {
  await this.prisma.$executeRaw`
    WITH
      user_validators AS (
        SELECT DISTINCT cv.validator_index
        FROM cluster_validator cv
        JOIN validator v ON v.id = cv.validator_index
        WHERE v.status IN (2, 3)
      ),
      attestations AS (
        SELECT
          c.validator_index,
          COUNT(*) AS total,
          SUM(CASE WHEN c.attestation_delay IS NULL OR c.attestation_delay > ${params.maxAttestationDelay}::int THEN 1 ELSE 0 END) AS missed
        FROM committee c
        JOIN user_validators uv ON c.validator_index = uv.validator_index
        WHERE c.slot BETWEEN ${params.minSlot}::int AND ${params.maxSlot}::int
        GROUP BY c.validator_index
      ),
      rewards AS (
        SELECT
          er.validator_index,
          SUM(er.head + er.target + er.source) AS consensus_reward,
          SUM(er.missed_head + er.missed_target + er.missed_source) AS missed_reward
        FROM epoch_rewards er
        JOIN user_validators uv ON er.validator_index = uv.validator_index
        WHERE er.epoch BETWEEN (${params.minSlot}::int / ${params.maxSlot}::int) -- epoch range derived from slots
        GROUP BY er.validator_index
      ),
      performance_data AS (
        SELECT
          a.validator_index,
          CASE WHEN a.total > 0
            THEN ((a.total - a.missed)::numeric / a.total)::numeric(5,4)
            ELSE NULL
          END AS performance_1h,
          r.consensus_reward,
          r.missed_reward,
          -- APY = (consensus_reward / balance) * 8766
          CASE WHEN v.balance > 0 AND r.consensus_reward IS NOT NULL
            THEN (r.consensus_reward::numeric / v.balance * 8766)::numeric(5,2)
            ELSE NULL
          END AS apy_1h
        FROM attestations a
        LEFT JOIN rewards r ON a.validator_index = r.validator_index
        JOIN validator v ON v.id = a.validator_index
      )
    UPDATE validators_snapshot_stats vss
    SET
      performance_1h = pd.performance_1h,
      apy_1h = pd.apy_1h,
      consensus_reward_1h = pd.consensus_reward,
      missed_reward_1h = pd.missed_reward,
      updated_at = NOW()
    FROM performance_data pd
    WHERE vss.validator_index = pd.validator_index
  `;
}
```

**Note:** The exact SQL for epoch range calculation and execution rewards will need refinement based on the actual `epoch_rewards` table schema. Check the schema for exact column names — the epoch_rewards table has columns like `head`, `target`, `source`, `missed_head`, `missed_target`, `missed_source`, and is partitioned by epoch.

**Step 2: Verify type-check**

```bash
pnpm type-check
```

**Step 3: Commit**

```bash
git add packages/indexer/src/services/consensus/storage/snapshot.ts
git commit -m "feat(indexer): implement 1h performance storage method"
```

---

## Task 8: Performance Storage Methods (1d/1w/1m from archives)

**Files:**

- Modify: `packages/indexer/src/services/consensus/storage/snapshot.ts`

**Step 1: Implement `updatePerformance1d`**

Queries `ValidatorHourlyArchive` for the last 24 hours. The hourly archive has aggregate columns: `attestation_count`, `cl_reward_total`, `cl_missed_reward_total`, `exec_reward_total`.

```typescript
async updatePerformance1d(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await this.prisma.$executeRaw`
    WITH archive_data AS (
      SELECT
        vha.validator_index,
        SUM(vha.attestation_count) AS total_attestations,
        -- attestation_count includes all attestations, we need the missed count from the data
        SUM(vha.cl_reward_total) AS consensus_reward,
        SUM(vha.cl_missed_reward_total) AS missed_reward,
        SUM(vha.exec_reward_total) AS execution_reward
      FROM validator_hourly_archive vha
      WHERE vha.hour_timestamp >= ${cutoff}
      GROUP BY vha.validator_index
    ),
    performance AS (
      SELECT
        ad.validator_index,
        -- Performance ratio from archive rewards (if missed_reward = 0 then performance = 1.0)
        CASE WHEN (ad.consensus_reward + ad.missed_reward) > 0
          THEN (ad.consensus_reward::numeric / (ad.consensus_reward + ad.missed_reward))::numeric(5,4)
          ELSE NULL
        END AS performance_1d,
        ad.consensus_reward,
        ad.missed_reward,
        ad.execution_reward,
        CASE WHEN v.balance > 0 AND ad.consensus_reward IS NOT NULL
          THEN (ad.consensus_reward::numeric / v.balance * 365.25)::numeric(5,2)
          ELSE NULL
        END AS apy_1d
      FROM archive_data ad
      JOIN validator v ON v.id = ad.validator_index
    )
    UPDATE validators_snapshot_stats vss
    SET
      performance_1d = p.performance_1d,
      apy_1d = p.apy_1d,
      consensus_reward_1d = p.consensus_reward,
      missed_reward_1d = p.missed_reward,
      execution_reward_1d = p.execution_reward,
      updated_at = NOW()
    FROM performance p
    WHERE vss.validator_index = p.validator_index
  `;
}
```

**Step 2: Implement `updatePerformance1w`**

Same pattern but queries `ValidatorDailyArchive` for the last 7 days. Uses `periods_per_year = 52.18`.

**Step 3: Implement `updatePerformance1m`**

Same pattern but queries `ValidatorDailyArchive` for the last 30 days. Uses `periods_per_year = 12`.

**Step 4: Verify type-check**

```bash
pnpm type-check
```

**Step 5: Commit**

```bash
git add packages/indexer/src/services/consensus/storage/snapshot.ts
git commit -m "feat(indexer): implement 1d/1w/1m performance storage methods from archives"
```

---

## Task 9: Wire Performance Methods in Controller and Machine

**Files:**

- Modify: `packages/indexer/src/services/consensus/controllers/snapshot.ts`
- Modify: `packages/indexer/src/xstate/snapshot/snapshot.machine.ts`

**Step 1: Implement controller performance methods**

Each method calls the corresponding storage method with computed parameters:

```typescript
async updatePerformance1h() {
  const currentTimestamp = Date.now();
  const currentSlot = this.beaconTime.getSlotNumberFromTimestamp(currentTimestamp);
  const oneHourAgoSlot = this.beaconTime.getSlotNumberFromTimestamp(currentTimestamp - ms('1h'));

  await this.snapshotStorage.updatePerformance1h({
    minSlot: oneHourAgoSlot,
    maxSlot: currentSlot,
    maxAttestationDelay: /* passed via constructor or params */,
  });
  this.logger.info('Updated 1h performance metrics');
}

async updatePerformance1d() {
  await this.snapshotStorage.updatePerformance1d();
  this.logger.info('Updated 1d performance metrics');
}

async updatePerformance1w() {
  await this.snapshotStorage.updatePerformance1w();
  this.logger.info('Updated 1w performance metrics');
}

async updatePerformance1m() {
  await this.snapshotStorage.updatePerformance1m();
  this.logger.info('Updated 1m performance metrics');
}
```

**Step 2: Uncomment the performance calls in the machine**

In `snapshot.machine.ts`, uncomment the calls to `controller.updatePerformance1h/1d/1w/1m` in the `runTick` actor. Add proper epoch detection logic for the 1h and balances levels.

**Step 3: Verify type-check**

```bash
pnpm type-check
```

**Step 4: Commit**

```bash
git add packages/indexer/src/services/consensus/controllers/snapshot.ts packages/indexer/src/xstate/snapshot/snapshot.machine.ts
git commit -m "feat(indexer): wire performance methods in controller and machine"
```

---

## Task 10: API — Snapshot Endpoint

**Files:**

- Create: `packages/api/src/routers/cluster/snapshot.ts`
- Modify: `packages/api/src/routers/cluster/schemas.ts`
- Modify: `packages/api/src/routers/cluster/index.ts`
- Modify: `packages/api/src/storage/cluster.ts`

**Step 1: Add Zod schema for snapshot response**

In `packages/api/src/routers/cluster/schemas.ts`, add:

```typescript
export const ClusterSnapshotSchema = z.object({
  activeCount: z.number(),
  inactiveCount: z.number(),
  statusBreakdown: z.record(z.string(), z.number()),

  totalBalance: z.string(),
  totalEffectiveBalance: z.string(),

  attestationsTotal: z.number(),
  attestationsMissed: z.number(),

  performance1h: z.number().nullable(),
  performance1d: z.number().nullable(),
  performance1w: z.number().nullable(),
  performance1m: z.number().nullable(),

  apy1h: z.number().nullable(),
  apy1d: z.number().nullable(),
  apy1w: z.number().nullable(),
  apy1m: z.number().nullable(),

  consensusReward1h: z.string().nullable(),
  consensusReward1d: z.string().nullable(),
  consensusReward1w: z.string().nullable(),
  consensusReward1m: z.string().nullable(),

  missedReward1h: z.string().nullable(),
  missedReward1d: z.string().nullable(),
  missedReward1w: z.string().nullable(),
  missedReward1m: z.string().nullable(),

  executionReward1h: z.string().nullable(),
  executionReward1d: z.string().nullable(),
  executionReward1w: z.string().nullable(),
  executionReward1m: z.string().nullable(),
});
```

**Step 2: Add storage method**

In `packages/api/src/storage/cluster.ts`, add a method to query aggregated snapshot data for a cluster's validators:

```typescript
async getClusterSnapshot(clusterId: string) {
  // Raw SQL that joins cluster_validator with validators_snapshot_stats
  // Aggregates: SUM for rewards/balances/attestations, weighted AVG for performance/APY
  const result = await this.prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE vss.is_inactive = false) AS active_count,
      COUNT(*) FILTER (WHERE vss.is_inactive = true) AS inactive_count,
      SUM(vss.balance) AS total_balance,
      SUM(vss.effective_balance) AS total_effective_balance,
      SUM(vss.attestations_total) AS attestations_total,
      SUM(vss.attestations_missed) AS attestations_missed,
      -- Weighted average performance
      CASE WHEN SUM(vss.attestations_total) > 0
        THEN (SUM(COALESCE(vss.performance_1h, 0) * vss.attestations_total) / SUM(vss.attestations_total))::numeric(5,4)
        ELSE NULL END AS performance_1h,
      -- ... similar for 1d, 1w, 1m
      -- Weighted average APY by balance
      CASE WHEN SUM(vss.balance) > 0
        THEN (SUM(COALESCE(vss.apy_1h, 0) * vss.balance) / SUM(vss.balance))::numeric(5,2)
        ELSE NULL END AS apy_1h,
      -- ... similar for 1d, 1w, 1m
      -- Sum rewards
      SUM(vss.consensus_reward_1h) AS consensus_reward_1h,
      -- ... all reward fields
    FROM cluster_validator cv
    JOIN validators_snapshot_stats vss ON cv.validator_index = vss.validator_index
    WHERE cv.cluster_id = ${clusterId}
  `;
  return result;
}
```

**Step 3: Create the endpoint**

```typescript
// packages/api/src/routers/cluster/snapshot.ts
import { ClusterIdParamSchema, ClusterSnapshotSchema } from './schemas.js';
import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

export const getClusterSnapshot = publicProcedure
  .route({ method: 'GET', path: '/clusters/{id}/snapshot' })
  .input(ClusterIdParamSchema)
  .output(ApiResponseSchema(ClusterSnapshotSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();
      const snapshot = await storage.getClusterSnapshot(input.id);
      return {
        success: true,
        data: snapshot,
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get snapshot';
      return {
        success: false,
        error: { code: 'SNAPSHOT_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
```

**Step 4: Register in cluster router**

In `packages/api/src/routers/cluster/index.ts`:

```typescript
import { getClusterSnapshot } from './snapshot.js';
// ...
export const clusterRouter = {
  // ... existing
  snapshot: getClusterSnapshot,
};
```

**Step 5: Verify type-check**

```bash
pnpm type-check
```

**Step 6: Commit**

```bash
git add packages/api/src/
git commit -m "feat(api): add cluster snapshot endpoint with performance metrics"
```

---

## Task 11: Webapp — Performance Table Component

**Files:**

- Create: `packages/webapp/components/validators/performance-table.tsx`
- Modify: `packages/webapp/components/validators/cluster-overview-content.tsx`
- Modify: `packages/webapp/hooks/use-clusters.ts` (or create `use-cluster-snapshot.ts`)

**Step 1: Create the hook for snapshot data**

```typescript
// If not already fetched by an existing hook, create:
export function useClusterSnapshot(clusterId: string | null) {
  return useQuery({
    queryKey: ['cluster-snapshot', clusterId],
    queryFn: async () => {
      if (!clusterId) return null;
      const response = await orpcClient.cluster.snapshot({ id: clusterId });
      if (!response.success) throw new Error(response.error?.message);
      return response.data;
    },
    enabled: !!clusterId,
  });
}
```

**Step 2: Create the Performance Table component**

```tsx
// packages/webapp/components/validators/performance-table.tsx
const PERIODS = ['1h', '1d', '1w', '1m'] as const;

type PerformanceTableProps = {
  snapshot: ClusterSnapshot | null;
};

export function PerformanceTable({ snapshot }: PerformanceTableProps) {
  if (!snapshot) return null;

  const rows = PERIODS.map((period) => ({
    period,
    apy: snapshot[`apy${period.charAt(0).toUpperCase() + period.slice(1)}`],
    consensus: snapshot[`consensusReward${period.charAt(0).toUpperCase() + period.slice(1)}`],
    missed: snapshot[`missedReward${period.charAt(0).toUpperCase() + period.slice(1)}`],
    execution: snapshot[`executionReward${period.charAt(0).toUpperCase() + period.slice(1)}`],
  }));

  return (
    <table>
      <thead>
        <tr>
          <th>Period</th>
          <th>APY%</th>
          <th>Consensus</th>
          <th>Missed Rewards</th>
          <th>Execution</th>
          <th>Total USD</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.period}>
            <td>{row.period}</td>
            <td>{row.apy != null ? `${row.apy}%` : '-'}</td>
            <td>{row.consensus != null ? formatGwei(row.consensus) : '-'}</td>
            <td>{row.missed != null ? formatGwei(row.missed) : '-'}</td>
            <td>{row.execution != null ? formatGwei(row.execution) : '-'}</td>
            <td>-</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Style this using Tailwind classes consistent with the existing UI patterns in `cluster-overview-content.tsx`.

**Step 3: Integrate into cluster overview**

In `cluster-overview-content.tsx`, import and render the `PerformanceTable` component in the appropriate section of the cluster dashboard.

**Step 4: Verify the app builds**

```bash
cd packages/webapp && pnpm build
```

**Step 5: Commit**

```bash
git add packages/webapp/
git commit -m "feat(webapp): add performance table component to cluster dashboard"
```

---

## Task 12: Final Verification and Cleanup

**Step 1: Run all tests**

```bash
pnpm test
pnpm test:e2e:local
```

**Step 2: Run linting**

```bash
pnpm lint
```

**Step 3: Run type-check across all packages**

```bash
pnpm type-check
```

**Step 4: Verify no references to old names remain**

Search for `validators_status_summary`, `SummaryController`, `SummaryStorage`, `validatorsStatusSummary` in the codebase. If any remain, update them.

**Step 5: Update AGENTS.md files if needed**

If the snapshot machine introduces new patterns or important knowledge, update:

- `packages/indexer/AGENTS.md`
- `packages/api/AGENTS.md`

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore: cleanup and verify snapshot performance metrics implementation"
```
