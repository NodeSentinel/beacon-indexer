---
date: 2026-02-10T22:34:08+0000
researcher: Claude
git_commit: 6bc4e021dbeb44e010d28d44ebf8be4df8468cd6
branch: main
repository: NodeSentinel/beacon-chain-validators-monitor
topic: '[Indexer] Chain stats job — GH-65'
tags: [research, codebase, indexer, xstate, chain-stats, epoch-processing]
status: complete
last_updated: 2026-02-10
last_updated_by: Claude
last_updated_note: 'Resolved all 3 open questions with user feedback: consolidation data source, validatorsExiting scope, epoch as freshness marker'
---

# Research: [Indexer] Chain Stats Job (GH-65)

**Date**: 2026-02-10T22:34:08+0000
**Researcher**: Claude
**Git Commit**: 6bc4e021dbeb44e010d28d44ebf8be4df8468cd6
**Branch**: main
**Repository**: NodeSentinel/beacon-chain-validators-monitor

## Research Question

Research the codebase to understand all existing patterns, architecture, and dependencies needed to implement the chain stats job described in GitHub issue #65 — a cron job that writes global chain statistics to the `chain_epoch_stats` table at the end of each epoch, triggered by `EPOCH_PROCESSED`.

## Summary

The chain stats job will follow a well-established pattern in the codebase: an XState machine that listens for `EPOCH_PROCESSED` events and delegates to a controller/storage pair. The primary reference implementation is the **hourly archive machine** (`packages/indexer/src/xstate/archive/hourlyArchive.machine.ts`). The target table `chain_epoch_stats` already exists (added in GH-64, commit `6bc4e02`). The job needs to query the `validator` table for status-based counts and effective balance sums, then upsert a single row per epoch.

## Detailed Findings

### 1. Target Table: ChainEpochStats

**Schema**: [`packages/db/prisma/schema.prisma:324-333`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/db/prisma/schema.prisma#L324-L333)

```prisma
model ChainEpochStats {
    epoch                   Int    @id @map("epoch")
    totalActiveValidators   Int    @map("total_active_validators")
    totalStaked             BigInt @map("total_staked")
    validatorsEntering      Int    @map("validators_entering")
    validatorsExiting       Int    @map("validators_exiting")
    validatorsConsolidating Int    @map("validators_consolidating")
    @@map("chain_epoch_stats")
}
```

**SQL Table**: [`packages/db/prisma/migrations/20251210144216_initial/migration.sql:229-239`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/db/prisma/migrations/20251210144216_initial/migration.sql#L229-L239)

Key characteristics:

- **Primary key**: `epoch` (integer) — one row per epoch
- **Not partitioned** — unlike other epoch tables, this stores data indefinitely
- **No timestamps** — no `createdAt`/`updatedAt`
- **No foreign keys** — standalone table
- **BigInt** for `total_staked` to accommodate large sums of effective balances

### 2. EPOCH_PROCESSED Event Flow

The `EPOCH_PROCESSED` event is the trigger for the chain stats job. Here is the complete event flow:

```
epochProcessorMachine (completes epoch N)
  └─ sendParent(EPOCH_COMPLETED { epoch, machineId })
       └─ epochWorkerMachine
            └─ sendParent(EPOCH_COMPLETED { epoch, machineId })
                 └─ epochOrchestratorMachine (global handler)
                      ├─ stopChild(epochWorker:N)
                      ├─ assign({ epochs[N]: 'completed' })
                      └─ sendTo(hourlyArchiveActor, { type: 'EPOCH_PROCESSED', epoch })
```

**Emission point**: [`packages/indexer/src/xstate/epoch/epochOrchestrator.machine.ts:289-293`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/epoch/epochOrchestrator.machine.ts#L289-L293)

```typescript
sendTo(
  ({ context }) => context.hourlyArchiveActor,
  ({ event }) => ({ type: 'EPOCH_PROCESSED' as const, epoch: event.epoch }),
),
```

**Event payload**: `{ type: 'EPOCH_PROCESSED'; epoch: number }`

Currently, `EPOCH_PROCESSED` is sent **only** to the `hourlyArchiveActor`. The chain stats job will need to also receive this event. This requires modifying the epoch orchestrator to send to the new actor as well.

### 3. Reference Pattern: Hourly Archive Machine

The hourly archive machine is the canonical pattern for epoch-triggered jobs.

#### 3.1 Machine Definition

**File**: [`packages/indexer/src/xstate/archive/hourlyArchive.machine.ts`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/archive/hourlyArchive.machine.ts)

Two-state machine:

- **`idle`** (initial): Waits for `EPOCH_PROCESSED`, transitions to `archiving`
- **`archiving`**: Invokes controller method, handles success/failure/no-op, ignores additional `EPOCH_PROCESSED` events (non-overlapping execution)

Key elements:

- **Context**: `{ hourlyArchiveController: HourlyArchiveController }` (line 19-21)
- **Events**: `{ type: 'EPOCH_PROCESSED'; epoch: number }` (line 22)
- **Input**: `{ hourlyArchiveController: HourlyArchiveController }` (lines 23-25)
- **Actor**: `runArchive` — `fromPromise` that calls `controller.archive()` (lines 28-32)
- **Guard**: `archiveSucceeded` — checks if output is non-null (lines 35-39)
- **Non-overlapping**: While in `archiving`, additional `EPOCH_PROCESSED` events are logged and ignored (lines 101-109)

#### 3.2 Actor Factory

**File**: [`packages/indexer/src/xstate/archive/index.ts:14-26`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/archive/index.ts#L14-L26)

```typescript
export const getHourlyArchiveActor = (hourlyArchiveController: HourlyArchiveController) => {
  const actor = createActor(hourlyArchiveMachine, {
    input: { hourlyArchiveController },
  });
  actor.subscribe((snapshot) => {
    logMachine('hourlyArchive', `State: ${JSON.stringify(snapshot.value)}`);
  });
  return actor;
};
```

#### 3.3 Wiring to Epoch Orchestrator

**File**: [`packages/indexer/src/xstate/index.ts:12-39`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/index.ts#L12-L39)

1. Create hourly archive actor (line 23)
2. Start hourly archive actor (line 24)
3. Pass actor reference to epoch orchestrator as input (line 37)
4. Epoch orchestrator stores it in context and sends events to it

**Epoch orchestrator context** stores the actor ref at [`epochOrchestrator.machine.ts:86`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/epoch/epochOrchestrator.machine.ts#L86)

#### 3.4 Main Initialization

**File**: [`packages/indexer/src/index.ts:167-188`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/index.ts#L167-L188)

```
HourlyArchiveStorage(prisma) → HourlyArchiveController(storage, partitionController, beaconTime, maxDelay) → initXstateMachines(hourlyArchiveController)
```

### 4. Controller Patterns

#### 4.1 GlobalStatsController (Most Similar Pattern)

**File**: [`packages/indexer/src/services/consensus/controllers/globalStats.ts`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/services/consensus/controllers/globalStats.ts)

This controller is the closest existing pattern to the chain stats job — it aggregates validator data:

```typescript
export class GlobalStatsController {
  constructor(private readonly storage: GlobalStatsStorage) {}

  async runDailyAggregation(when: Date = new Date()) {
    const { date } = convertToUTC(when);
    const dayUtc = new Date(`${date}T00:00:00.000Z`);
    await this.storage.upsertDailyValidatorStatsRaw(dayUtc, {
      pendingQueued: VALIDATOR_STATUS.pending_queued,
      activeOngoing: VALIDATOR_STATUS.active_ongoing,
      activeExiting: VALIDATOR_STATUS.active_exiting,
    });
    return { date: dayUtc };
  }
}
```

Key patterns:

- Constructor receives only storage
- Passes enum values to storage to avoid coupling
- Storage performs the aggregation query + upsert in raw SQL
- Returns minimal result

#### 4.2 HourlyArchiveController (Machine-Integrated Pattern)

**File**: [`packages/indexer/src/services/consensus/controllers/hourlyArchive.ts`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/services/consensus/controllers/hourlyArchive.ts)

This controller is integrated with the XState machine pattern:

- Main method (`archive()`) returns `Date | null`
- Returns `null` for "no work available" (handled as no-op by machine)
- Throws errors for invalid states (handled by machine's `onError`)
- Performs readiness validation before execution

### 5. Storage Patterns

#### 5.1 Upsert with ON CONFLICT (GlobalStatsStorage)

**File**: [`packages/indexer/src/services/consensus/storage/globalStats.ts:18-65`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/services/consensus/storage/globalStats.ts#L18-L65)

Uses `prisma.$executeRaw` with:

- `INSERT INTO ... SELECT ... FROM "validator" WHERE ...` — aggregation in the INSERT
- `ON CONFLICT ("date") DO UPDATE SET ...` — upsert on unique key
- Status values passed as parameters from controller

This is the pattern the chain stats storage should follow — aggregate from `validator` table and upsert into `chain_epoch_stats`.

#### 5.2 Storage Constructor Pattern

All storage classes follow:

```typescript
constructor(private readonly prisma: PrismaClient)
```

Some add `databaseUrl: string` for native pg pool (COPY operations), but this is not needed for the chain stats job which only does simple aggregation + upsert.

### 6. Validator Status Types

**Definition**: [`packages/beacon-utils/src/validatorStatus.ts:5-27`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/beacon-utils/src/validatorStatus.ts#L5-L27)

```typescript
export const VALIDATOR_STATUS = {
  pending_initialized: 0,
  pending_queued: 1,
  active_ongoing: 2,
  active_exiting: 3,
  active_slashed: 4,
  exited_unslashed: 5,
  exited_slashed: 6,
  withdrawal_possible: 7,
  withdrawal_done: 8,
} as const;
```

**Validator table** stores status as `Int?` with an index: [`packages/db/prisma/schema.prisma:12`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/db/prisma/schema.prisma#L12)

#### Status groupings for chain stats fields:

Based on issue #65 requirements and existing codebase patterns:

| Field                     | Statuses to Count                                                                                 | Codes   |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ------- |
| `totalActiveValidators`   | `active_ongoing`, `active_exiting`, `active_slashed`                                              | 2, 3, 4 |
| `totalStaked`             | Sum of `effective_balance` for active validators (same set)                                       | 2, 3, 4 |
| `validatorsEntering`      | `pending_initialized`, `pending_queued`                                                           | 0, 1    |
| `validatorsExiting`       | `active_exiting` only                                                                             | 3       |
| `validatorsConsolidating` | Count of distinct source pubkeys in `validator_request_consolidations` for the epoch's slot range | —       |

**Existing grouping references**:

- Active validators: [`packages/indexer/src/services/consensus/storage/validators.ts:115-118`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/services/consensus/storage/validators.ts#L115-L118) — uses statuses 2, 3, 4
- Daily stats: [`packages/indexer/src/services/consensus/storage/globalStats.ts:17-19`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/services/consensus/storage/globalStats.ts#L17-L19) — counts by individual status

### 6.1 Consolidation Requests Table

**Schema**: [`packages/db/prisma/schema.prisma:194-201`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/db/prisma/schema.prisma#L194-L201)

```prisma
model validatorConsolidationsRequests {
    slot         Int    @map("slot")
    sourcePubkey String @map("source_pubkey") @db.VarChar(98)
    targetPubkey String @map("target_pubkey") @db.VarChar(98)

    @@id([slot, sourcePubkey, targetPubkey])
    @@map("validator_request_consolidations")
}
```

This table tracks consolidation events emitted during epoch processing. A validator can consolidate into another validator, generating a transaction event tracked here. The `validatorsConsolidating` field in `chain_epoch_stats` counts distinct source pubkeys from this table for slots within the epoch's range. The storage query will need to join with `BeaconTime` to calculate the epoch's start/end slots.

### 7. E2E Test Patterns

**Test location**: `packages/indexer/e2e/`

#### 7.1 Test Structure

Existing test files:

- `e2e/epoch/epochProcessor/epochProcessor.test.ts` — Epoch reward, committee, sync processing
- `e2e/epoch/epochCreator.test.ts` — Epoch creation
- `e2e/epoch/epochPartitioning.test.ts` — Partition management
- `e2e/slot/slotProcessor/slotProcessor.test.ts` — Slot processing
- `e2e/archive/hourlyArchive.test.ts` — Hourly archive (best reference for chain stats)
- `e2e/validators/validators.test.ts` — Validator initialization

#### 7.2 Test Pattern (from hourlyArchive.test.ts)

**Setup** (`beforeAll`):

1. Create `PrismaClient` with `process.env.DATABASE_URL`
2. Instantiate storage and controller classes
3. Initialize `BeaconTime` with chain config

**Cleanup** (`beforeEach`):

1. Drop all test partitions via raw SQL
2. Delete all test data from relevant tables
3. Reset control tables to initial state

**Test Flow**:

1. Insert prerequisite data (validators, epochs, etc.)
2. Call controller method directly (not via XState machine)
3. Query database to verify results
4. Assert specific field values

**Teardown** (`afterAll`):

1. Close static pg pools (`EpochStorage.closePgPool()`, etc.)
2. Disconnect Prisma (`prisma.$disconnect()`)

#### 7.3 Mock Data

- Real Gnosis chain data stored as JSON in `e2e/**/mocks/*.json`
- Imported with `import data from './mocks/file.json' with { type: 'json' }`
- For simple tests, inline data via `prisma.model.createMany()`
- Mock BeaconClient with `vi.fn()` when needed

### 8. Epoch Orchestrator — Points of Modification

To wire the chain stats actor into the epoch orchestrator, these locations need changes:

#### 8.1 Context Type

[`epochOrchestrator.machine.ts:82-101`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/epoch/epochOrchestrator.machine.ts#L82-L101) — Add `chainStatsActor` to context type alongside `hourlyArchiveActor`

#### 8.2 Input Type

[`epochOrchestrator.machine.ts:107-114`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/epoch/epochOrchestrator.machine.ts#L107-L114) — Add `chainStatsActor` to input type

#### 8.3 Context Assignment from Input

[`epochOrchestrator.machine.ts:139-147`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/epoch/epochOrchestrator.machine.ts#L139-L147) — Map `chainStatsActor` from input to context

#### 8.4 Event Forwarding

[`epochOrchestrator.machine.ts:289-293`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/epoch/epochOrchestrator.machine.ts#L289-L293) — Add a second `sendTo` action for `chainStatsActor`

#### 8.5 initXstateMachines

[`packages/indexer/src/xstate/index.ts:12-39`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/index.ts#L12-L39) — Accept `chainStatsController`, create and start actor, pass to orchestrator

#### 8.6 Main index.ts

[`packages/indexer/src/index.ts:167-188`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/index.ts#L167-L188) — Instantiate `ChainStatsStorage`, `ChainStatsController`, pass to `initXstateMachines`

### 9. Logging Pattern

**File**: [`packages/indexer/src/xstate/pinoLog.ts`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/6bc4e021dbeb44e010d28d44ebf8be4df8468cd6/packages/indexer/src/xstate/pinoLog.ts)

All XState machines use `pinoLog` for structured logging. The hourly archive machine logs at these points:

- Entering processing state (info level)
- Success with result data (info level)
- No-op when no work available (info level)
- Error with error details (error level)
- Ignored events during processing (debug level)

## Code References

### New files to create:

- `packages/indexer/src/xstate/chainStats/chainStats.machine.ts` — XState machine
- `packages/indexer/src/xstate/chainStats/index.ts` — Actor factory
- `packages/indexer/src/services/consensus/controllers/chainStats.ts` — Controller
- `packages/indexer/src/services/consensus/storage/chainStats.ts` — Storage
- `packages/indexer/e2e/chainStats/chainStats.test.ts` — E2E tests

### Files to modify:

- `packages/indexer/src/xstate/epoch/epochOrchestrator.machine.ts` — Add chainStatsActor to context, input, and event forwarding
- `packages/indexer/src/xstate/index.ts` — Accept chainStatsController, create/start actor
- `packages/indexer/src/index.ts` — Instantiate storage/controller, pass to initXstateMachines

### Reference files (patterns to follow):

- `packages/indexer/src/xstate/archive/hourlyArchive.machine.ts` — Machine pattern
- `packages/indexer/src/xstate/archive/index.ts` — Actor factory pattern
- `packages/indexer/src/services/consensus/controllers/globalStats.ts` — Stats controller pattern
- `packages/indexer/src/services/consensus/storage/globalStats.ts` — Stats upsert storage pattern
- `packages/indexer/e2e/archive/hourlyArchive.test.ts` — E2E test pattern
- `packages/beacon-utils/src/validatorStatus.ts` — Status codes

## Architecture Documentation

### Dependency Flow

```
XState Machine → Controller → Storage → Database
```

### Chain Stats Data Flow

```
Epoch Orchestrator
  └─ EPOCH_PROCESSED { epoch }
       └─ ChainStats Machine (idle → computing)
            └─ ChainStatsController.computeStats(epoch)
                 └─ ChainStatsStorage.upsertChainEpochStats(epoch, stats)
                      └─ INSERT INTO chain_epoch_stats ... ON CONFLICT (epoch) DO UPDATE
```

### Actor Wiring

```
main index.ts
  ├─ ChainStatsStorage(prisma)
  ├─ ChainStatsController(storage)
  └─ initXstateMachines(hourlyArchiveController, chainStatsController)
       ├─ getChainStatsActor(chainStatsController)
       ├─ chainStatsActor.start()
       └─ epochOrchestrator(input: { hourlyArchiveActor, chainStatsActor })
            └─ on EPOCH_COMPLETED:
                 ├─ sendTo(hourlyArchiveActor, EPOCH_PROCESSED)
                 └─ sendTo(chainStatsActor, EPOCH_PROCESSED)
```

## Historical Context (from thoughts/)

- `thoughts/shared/research/2026-02-10-GH-64-chain-epoch-stats-table.md` — Research for GH-64 (adding the `chain_epoch_stats` table). Documents the schema design and the fact that GH-65 would implement the indexer job.
- `thoughts/shared/plans/2026-02-10-GH-64-add-chain-epoch-stats-table.md` — Implementation plan for GH-64. References GH-65 as the next step for writing data to the table.

## Related Research

- [`thoughts/shared/research/2026-02-10-GH-64-chain-epoch-stats-table.md`](thoughts/shared/research/2026-02-10-GH-64-chain-epoch-stats-table.md)

## Resolved Questions

1. **`validatorsConsolidating` field**: Data comes from the `validator_request_consolidations` table (`validatorConsolidationsRequests` Prisma model). Count distinct `source_pubkey` values for slots within the epoch's slot range. Consolidation events are tracked per-slot during epoch processing.

2. **Status groupings for `validatorsExiting`**: Only `active_exiting` (code 3). The issue description was inaccurate — `exited_*` statuses should not be included.

3. **Epoch number as freshness marker**: The `validator` table stores current state with no epoch dimension. When the job runs on `EPOCH_PROCESSED` for epoch N, it queries validators as they are _now_ (reflecting epoch N's processing, since validator fetch happens as part of epoch processing). The epoch number serves as a **freshness marker** — the API consumes this data and compares the snapshot's epoch against the chain's head epoch to determine if the data is current. The epoch does not filter the validator query.
