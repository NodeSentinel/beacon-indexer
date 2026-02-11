# Chain Stats Job Implementation Plan (GH-65)

## Overview

Implement a cron-like job that writes global chain statistics to the `chain_epoch_stats` table at the end of each epoch. The job listens for `EPOCH_PROCESSED` events via an XState machine, delegates to a controller/storage pair that queries the `validator` table for status-based counts and effective balance sums, counts consolidation requests from `validator_request_consolidations`, and upserts one row per epoch. Finally, remove the now-obsolete `globalStats` controller/storage/utils files.

## Current State Analysis

- **Target table exists**: `chain_epoch_stats` added in GH-64 (commit `6bc4e02`). Schema at `packages/db/prisma/schema.prisma:324-333`.
- **No data writer yet**: The table exists but nothing writes to it.
- **Reference pattern established**: The hourly archive machine (`packages/indexer/src/xstate/archive/`) provides the canonical XState → Controller → Storage pattern.
- **Legacy code to remove**: `GlobalStatsController`, `GlobalStatsStorage`, and `aggregateBeaconDailyStats.ts` write to the old `beacon_daily_validator_stats` table and are unused by any other code.

### Key Discoveries:

- `EPOCH_PROCESSED` is sent only to `hourlyArchiveActor` at `epochOrchestrator.machine.ts:289-293` — needs a second `sendTo`
- `BeaconTime.getEpochSlots(epoch)` returns `{ startSlot, endSlot }` where endSlot is the last slot (inclusive) — useful for consolidation slot range
- `validator` table stores current state, no epoch dimension — the epoch number is a freshness marker
- `validator_request_consolidations` has composite PK `(slot, source_pubkey, target_pubkey)` — count distinct `source_pubkey` for consolidating validators
- Active validator statuses: `active_ongoing=2, active_exiting=3, active_slashed=4`
- Entering validator statuses: `pending_initialized=0, pending_queued=1`
- Exiting: `active_exiting=3` only

## Desired End State

After implementation:

1. Every `EPOCH_PROCESSED` event triggers the chain stats machine, which computes and upserts a row into `chain_epoch_stats`
2. The `chain_epoch_stats` table accumulates one row per processed epoch with correct aggregate values
3. The legacy `globalStats` files are removed
4. E2E tests verify the full flow (seeded data → controller call → database assertions)

### Verification:

- `pnpm type-check` passes
- `pnpm lint` passes
- `pnpm test` passes (unit tests)
- `pnpm test:e2e:local` passes (e2e tests including new chain stats test)

## What We're NOT Doing

- No schema changes to `chain_epoch_stats` — table already exists
- No API endpoints for reading chain stats (separate ticket)
- No changes to how `EPOCH_PROCESSED` is emitted by epoch workers

## Implementation Approach

Follow the exact same layered pattern as hourly archive: Storage (raw SQL) → Controller (business logic) → XState machine (event handling) → Wiring (epoch orchestrator + main index). Each layer is independently testable. The e2e test calls the controller directly (not via XState) to verify correctness.

---

## Phase 1: Storage Layer

### Overview

Create `ChainStatsStorage` with a single raw SQL upsert method that aggregates from `validator` and `validator_request_consolidations`.

### Changes Required:

- [x] **1. Create `ChainStatsStorage`**
      **File**: `packages/indexer/src/services/consensus/storage/chainStats.ts` (new)
      **Changes**: New class with `upsertChainEpochStats` method

  ```typescript
  import { PrismaClient } from '@beacon-indexer/db';

  export class ChainStatsStorage {
    constructor(private readonly prisma: PrismaClient) {}

    /**
     * Single-shot raw SQL: aggregates validator stats and consolidation requests,
     * then upserts into chain_epoch_stats.
     *
     * Status codes are passed in from the controller to avoid coupling.
     */
    async upsertChainEpochStats(
      epoch: number,
      activeStatuses: number[],
      enteringStatuses: number[],
      exitingStatus: number,
      startSlot: number,
      endSlot: number,
    ) {
      // Prisma tagged template doesn't support array spreading in IN clauses,
      // so we use Prisma.join() for the status arrays.
      const { Prisma } = await import('@beacon-indexer/db');

      await this.prisma.$executeRaw`
        INSERT INTO "chain_epoch_stats" (
          "epoch",
          "total_active_validators",
          "total_staked",
          "validators_entering",
          "validators_exiting",
          "validators_consolidating"
        )
        SELECT
          ${epoch}::int AS "epoch",
  
          -- Active validators: active_ongoing + active_exiting + active_slashed
          (SELECT COUNT(*)::int FROM "validator" WHERE "status" IN (${Prisma.join(activeStatuses)}))
            AS "total_active_validators",
  
          -- Total staked: sum of effective_balance for active validators
          (SELECT COALESCE(SUM("effective_balance"), 0) FROM "validator" WHERE "status" IN (${Prisma.join(activeStatuses)}))
            AS "total_staked",
  
          -- Validators entering: pending_initialized + pending_queued
          (SELECT COUNT(*)::int FROM "validator" WHERE "status" IN (${Prisma.join(enteringStatuses)}))
            AS "validators_entering",
  
          -- Validators exiting: active_exiting only
          (SELECT COUNT(*)::int FROM "validator" WHERE "status" = ${exitingStatus})
            AS "validators_exiting",
  
          -- Validators consolidating: distinct source pubkeys in consolidation requests for this epoch's slot range
          (SELECT COUNT(DISTINCT "source_pubkey")::int FROM "validator_request_consolidations"
           WHERE "slot" >= ${startSlot} AND "slot" <= ${endSlot})
            AS "validators_consolidating"
  
        ON CONFLICT ("epoch") DO UPDATE SET
          "total_active_validators" = EXCLUDED."total_active_validators",
          "total_staked"            = EXCLUDED."total_staked",
          "validators_entering"     = EXCLUDED."validators_entering",
          "validators_exiting"      = EXCLUDED."validators_exiting",
          "validators_consolidating"= EXCLUDED."validators_consolidating";
      `;
    }
  }
  ```

### Success Criteria:

#### Automated Verification:

- [x] Type checking passes: `pnpm type-check --filter @beacon-indexer/indexer`
- [x] Linting passes: `pnpm lint --filter @beacon-indexer/indexer`

---

## Phase 2: Controller Layer

### Overview

Create `ChainStatsController` with a `computeStats(epoch)` method that resolves the epoch's slot range and delegates to storage.

### Changes Required:

- [x] **1. Create `ChainStatsController`**
      **File**: `packages/indexer/src/services/consensus/controllers/chainStats.ts` (new)
      **Changes**: New class following GlobalStatsController pattern

  ```typescript
  import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';
  import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

  import { ChainStatsStorage } from '../storage/chainStats.js';

  export class ChainStatsController {
    constructor(
      private readonly storage: ChainStatsStorage,
      private readonly beaconTime: BeaconTime,
    ) {}

    async computeStats(epoch: number): Promise<{ epoch: number }> {
      const { startSlot, endSlot } = this.beaconTime.getEpochSlots(epoch);

      await this.storage.upsertChainEpochStats(
        epoch,
        [
          VALIDATOR_STATUS.active_ongoing,
          VALIDATOR_STATUS.active_exiting,
          VALIDATOR_STATUS.active_slashed,
        ],
        [VALIDATOR_STATUS.pending_initialized, VALIDATOR_STATUS.pending_queued],
        VALIDATOR_STATUS.active_exiting,
        startSlot,
        endSlot,
      );

      return { epoch };
    }
  }
  ```

### Success Criteria:

#### Automated Verification:

- [x] Type checking passes: `pnpm type-check --filter @beacon-indexer/indexer`
- [x] Linting passes: `pnpm lint --filter @beacon-indexer/indexer`

---

## Phase 3: XState Machine + Actor Factory

### Overview

Create a two-state machine (idle → computing) that listens for `EPOCH_PROCESSED` and invokes the controller, plus a factory function to create the actor.

### Changes Required:

- [x] **1. Create `chainStatsMachine`**
      **File**: `packages/indexer/src/xstate/chainStats/chainStats.machine.ts` (new)
      **Changes**: Two-state machine following hourlyArchive.machine.ts pattern

  ```typescript
  import { setup, fromPromise } from 'xstate';

  import { ChainStatsController } from '@/src/services/consensus/controllers/chainStats.js';
  import { pinoLog } from '@/src/xstate/pinoLog.js';

  export const chainStatsMachine = setup({
    types: {} as {
      context: {
        chainStatsController: ChainStatsController;
      };
      events: { type: 'EPOCH_PROCESSED'; epoch: number };
      input: {
        chainStatsController: ChainStatsController;
      };
    },
    actors: {
      runComputeStats: fromPromise(
        async ({ input }: { input: { controller: ChainStatsController; epoch: number } }) => {
          return await input.controller.computeStats(input.epoch);
        },
      ),
    },
  }).createMachine({
    id: 'ChainStats',
    initial: 'idle',
    context: ({ input }) => ({
      chainStatsController: input.chainStatsController,
    }),
    states: {
      idle: {
        description: 'Waiting for EPOCH_PROCESSED event',
        on: {
          EPOCH_PROCESSED: {
            target: 'computing',
            actions: [
              pinoLog(
                ({ event }) =>
                  `Received EPOCH_PROCESSED for epoch ${event.epoch}, computing chain stats`,
                'ChainStats',
              ),
            ],
          },
        },
      },
      computing: {
        description: 'Computing and upserting chain stats for the epoch',
        invoke: {
          src: 'runComputeStats',
          input: ({ context, event }) => ({
            controller: context.chainStatsController,
            epoch: (event as { type: 'EPOCH_PROCESSED'; epoch: number }).epoch,
          }),
          onDone: {
            target: 'idle',
            actions: [
              pinoLog(
                ({ event }) => `Chain stats computed for epoch ${event.output.epoch}`,
                'ChainStats',
              ),
            ],
          },
          onError: {
            target: 'idle',
            actions: [
              pinoLog(({ event }) => `Chain stats error: ${event.error}`, 'ChainStats', 'error'),
            ],
          },
        },
        // While computing, ignore additional EPOCH_PROCESSED events (non-overlap)
        on: {
          EPOCH_PROCESSED: {
            actions: pinoLog(
              ({ event }) =>
                `Ignoring EPOCH_PROCESSED for epoch ${event.epoch} - chain stats computation in progress`,
              'ChainStats',
              'debug',
            ),
          },
        },
      },
    },
  });
  ```

- [x] **2. Create actor factory**
      **File**: `packages/indexer/src/xstate/chainStats/index.ts` (new)
      **Changes**: Factory function + re-export

  ```typescript
  import { createActor } from 'xstate';

  import { chainStatsMachine } from './chainStats.machine.js';

  import { ChainStatsController } from '@/src/services/consensus/controllers/chainStats.js';
  import { logMachine } from '@/src/xstate/multiMachineLogger.js';

  export { chainStatsMachine } from './chainStats.machine.js';

  export const getChainStatsActor = (chainStatsController: ChainStatsController) => {
    const actor = createActor(chainStatsMachine, {
      input: {
        chainStatsController,
      },
    });

    actor.subscribe((snapshot) => {
      logMachine('chainStats', `State: ${JSON.stringify(snapshot.value)}`);
    });

    return actor;
  };
  ```

### Success Criteria:

#### Automated Verification:

- [x] Type checking passes: `pnpm type-check --filter @beacon-indexer/indexer`
- [x] Linting passes: `pnpm lint --filter @beacon-indexer/indexer`

---

## Phase 4: Wiring

### Overview

Wire the chain stats actor into the epoch orchestrator event flow and initialize it from main index.ts.

### Changes Required:

- [x] **1. Modify epoch orchestrator machine**
      **File**: `packages/indexer/src/xstate/epoch/epochOrchestrator.machine.ts`
      **Changes**: - Add `chainStatsMachine` import (alongside `hourlyArchiveMachine`) - Add `chainStatsActor: ActorRefFrom<typeof chainStatsMachine>` to context type (line ~86) - Add `chainStatsActor: ActorRefFrom<typeof chainStatsMachine>` to input type (line ~112) - Add `chainStatsActor: input.chainStatsActor` to context assignment (line ~143) - Add second `sendTo` for `chainStatsActor` in `EPOCH_COMPLETED` handler (after line 293)

  ```typescript
  // In context type (alongside hourlyArchiveActor):
  chainStatsActor: ActorRefFrom<typeof chainStatsMachine>;

  // In input type (alongside hourlyArchiveActor):
  chainStatsActor: ActorRefFrom<typeof chainStatsMachine>;

  // In context assignment:
  chainStatsActor: input.chainStatsActor,

  // In EPOCH_COMPLETED handler (new sendTo after existing one):
  sendTo(
    ({ context }) => context.chainStatsActor,
    ({ event }) => ({ type: 'EPOCH_PROCESSED' as const, epoch: event.epoch }),
  ),
  ```

- [x] **2. Modify epoch orchestrator actor factory**
      **File**: `packages/indexer/src/xstate/epoch/index.ts`
      **Changes**: - Import `chainStatsMachine` type - Add `chainStatsActor` parameter to `getEpochOrchestratorActor` - Pass it through to machine input

  ```typescript
  // Add import:
  import { chainStatsMachine } from '@/src/xstate/chainStats/chainStats.machine.js';

  // Add parameter to getEpochOrchestratorActor:
  chainStatsActor: ActorRefFrom<typeof chainStatsMachine>,

  // Add to input:
  chainStatsActor,
  ```

- [x] **3. Modify `initXstateMachines`**
      **File**: `packages/indexer/src/xstate/index.ts`
      **Changes**: - Import `getChainStatsActor` - Import `ChainStatsController` - Add `chainStatsController` parameter - Create and start chain stats actor - Pass chain stats actor to epoch orchestrator

  ```typescript
  // Add imports:
  import { getChainStatsActor } from './chainStats/index.js';
  import { ChainStatsController } from '@/src/services/consensus/controllers/chainStats.js';

  // Add parameter:
  chainStatsController: ChainStatsController,

  // In function body (alongside hourly archive):
  const chainStatsActor = getChainStatsActor(chainStatsController);
  chainStatsActor.start();

  // Pass to getEpochOrchestratorActor:
  chainStatsActor,
  ```

- [x] **4. Modify main index.ts**
      **File**: `packages/indexer/src/index.ts`
      **Changes**: - Import `ChainStatsStorage` and `ChainStatsController` - Instantiate storage and controller - Pass controller to `initXstateMachines`

  ```typescript
  // Add imports:
  import { ChainStatsController } from '@/src/services/consensus/controllers/chainStats.js';
  import { ChainStatsStorage } from '@/src/services/consensus/storage/chainStats.js';

  // After hourly archive controller creation (~line 173):
  const chainStatsStorage = new ChainStatsStorage(prisma);
  const chainStatsController = new ChainStatsController(chainStatsStorage, beaconTime);

  // Add to initXstateMachines call:
  chainStatsController,
  ```

### Success Criteria:

#### Automated Verification:

- [x] Type checking passes: `pnpm type-check --filter @beacon-indexer/indexer`
- [x] Linting passes: `pnpm lint --filter @beacon-indexer/indexer`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 5: E2E Tests

### Overview

Create an e2e test that seeds validators and consolidation requests, calls the controller, and verifies the upserted row in `chain_epoch_stats`.

### Changes Required:

- [x] **1. Create e2e test**
      **File**: `packages/indexer/e2e/chainStats/chainStats.test.ts` (new)
      **Changes**: E2E test following hourlyArchive.test.ts pattern

  **Test setup**:
  - Create `PrismaClient` with `DATABASE_URL`
  - Instantiate `ChainStatsStorage`, `ChainStatsController`, `BeaconTime` (Gnosis config)

  **Test cleanup** (`beforeEach`):
  - `DELETE FROM chain_epoch_stats`
  - `DELETE FROM validator`
  - `DELETE FROM validator_request_consolidations`

  **Test case 1: "should compute and upsert chain stats for an epoch"**:
  1. Insert test validators with various statuses:
     - 3 validators with `status=2` (active_ongoing), varying effective_balance
     - 1 validator with `status=3` (active_exiting)
     - 1 validator with `status=4` (active_slashed)
     - 1 validator with `status=0` (pending_initialized)
     - 1 validator with `status=1` (pending_queued)
     - 1 validator with `status=5` (exited_unslashed)
  2. Insert consolidation requests for the test epoch's slot range:
     - 2 distinct `source_pubkey` entries within the slot range
     - 1 entry outside the slot range (should not be counted)
  3. Call `controller.computeStats(testEpoch)`
  4. Query `chain_epoch_stats` and assert:
     - `totalActiveValidators = 5` (3 ongoing + 1 exiting + 1 slashed)
     - `totalStaked` = sum of effective_balance for those 5
     - `validatorsEntering = 2` (1 initialized + 1 queued)
     - `validatorsExiting = 1` (active_exiting only)
     - `validatorsConsolidating = 2` (distinct source pubkeys in slot range)

  **Test case 2: "should upsert (update) if epoch already exists"**:
  1. Insert a row into `chain_epoch_stats` with stale data
  2. Insert fresh validators
  3. Call `controller.computeStats(sameEpoch)`
  4. Assert the row was updated with new values

  **Test case 3: "should handle zero validators and zero consolidations"**:
  1. No validators, no consolidations
  2. Call `controller.computeStats(epoch)`
  3. Assert all counts are 0 and totalStaked is 0

  **Teardown** (`afterAll`):
  - `prisma.$disconnect()`

### Success Criteria:

#### Automated Verification:

- [x] E2E tests pass: `pnpm test:e2e:local` (from project root)
- [x] Type checking passes: `pnpm type-check --filter @beacon-indexer/indexer`

#### Manual Verification:

- [ ] Review test output to confirm correct assertion values
- [ ] Verify the consolidation slot range boundary is correctly tested (in-range vs out-of-range)
- [ ] E2E tests pass: `pnpm test:e2e:local`

---

## Phase 6: Cleanup Legacy Code

### Overview

Remove the obsolete `globalStats` controller, storage, and utility files. The `beacon_daily_validator_stats` table they wrote to was never in the Prisma schema or any migration — it was created purely via raw SQL at runtime — so deleting the code is sufficient.

### Changes Required:

- [x] **1. Delete `GlobalStatsController`**
      **File**: `packages/indexer/src/services/consensus/controllers/globalStats.ts` (delete)

- [x] **2. Delete `GlobalStatsStorage`**
      **File**: `packages/indexer/src/services/consensus/storage/globalStats.ts` (delete)

- [x] **3. Delete `aggregateBeaconDailyStats` utility**
      **File**: `packages/indexer/src/services/consensus/utils/aggregateBeaconDailyStats.ts` (delete)

### Success Criteria:

#### Automated Verification:

- [x] Type checking passes: `pnpm type-check` (full monorepo — confirms no broken imports)
- [x] Linting passes: `pnpm lint`
- [x] All tests pass: `pnpm test`

---

## Testing Strategy

### E2E Tests:

- Controller called directly (not via XState machine) — consistent with existing pattern
- Seeded data covers all validator statuses to verify correct grouping
- Consolidation slot boundary testing (in-range vs out-of-range)
- Upsert idempotency verified
- Zero-data edge case

### XState Machine:

- Not tested in e2e (consistent with codebase pattern — hourly archive e2e also tests controller directly)
- Machine behavior (idle/computing transitions, non-overlap) is verified by XState's own type system

## Performance Considerations

- The storage query uses subqueries with `COUNT` and `SUM` on the indexed `status` column — efficient for the `validator` table
- The consolidation count query uses a range scan on `slot` column (part of the composite PK) — efficient
- One DB round-trip per epoch (single SQL statement with upsert)
- Non-overlapping execution ensures at most one computation at a time

## References

- Original ticket: GitHub issue #65
- Research: `thoughts/shared/research/2026-02-10-GH-65-chain-stats-job.md`
- Prior plan (table creation): `thoughts/shared/plans/2026-02-10-GH-64-add-chain-epoch-stats-table.md`
- Reference machine: `packages/indexer/src/xstate/archive/hourlyArchive.machine.ts`
- Reference storage: `packages/indexer/src/services/consensus/storage/globalStats.ts`
- Validator statuses: `packages/beacon-utils/src/validatorStatus.ts`
