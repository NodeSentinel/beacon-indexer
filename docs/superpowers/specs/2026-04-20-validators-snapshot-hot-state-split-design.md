# Validators Snapshot Hot State Split Design

## Goal

Remove deadlocks between the snapshot and validator activity workers by eliminating their shared write target.

## Problem

The indexer currently stores multiple hot concerns in `validators_snapshot_stats`.

- `snapshot` updates balances and performance fields with broad set-based updates.
- `validatorActivityStatus` updates activity fields slot by slot and also reconciles incidents.

Both workers write the same table on overlapping cadences. This creates avoidable lock contention and deadlocks.

## Design Decision

Replace the shared hot table with worker-owned hot tables.

- `validators_snapshot_activity`
  Purpose: validator activity and liveness state only.
  Owner: validator activity worker only.
- `validators_snapshot_balances`
  Purpose: validator balances and beacon status only.
  Owner: snapshot worker only.
- `validators_snapshot_performance`
  Purpose: rolling performance and reward metrics only.
  Owner: snapshot worker only.

This design keeps scheduling unchanged. The reliability fix comes from ownership boundaries, not from orchestration changes.

## Non-Goals

- No compatibility view that reassembles the old schema.
- No staged migration that preserves `validators_snapshot_stats`.
- No API refactor in the first PR.
- No scheduling changes for snapshot or activity processing.

## Source Of Truth

The new `validators_snapshot_*` tables are disposable hot state.

Authoritative data remains in the indexed raw and derived tables:

- `validator`
- `committee`
- `slot`
- `epoch_rewards`
- `validator_sync_rewards`
- `validator_hourly_archive`
- `validator_daily_archive`
- processor cursor tables such as `incident_processor_state`

If a `validators_snapshot_*` table is empty or rebuilt, its owning worker should recreate rows automatically during normal operation.

## Table Ownership

### validators_snapshot_activity

Fields move here from the old snapshot table:

- `validator_index`
- `status`
- `attestations_total`
- `attestations_missed`
- `is_inactive`
- `inactive_since_slot`
- `active_since_slot`
- `consecutive_missed_attestations`
- `missed_streak_started_at_slot`
- `updated_at`

Write rules:

- Written only by the current validator activity pipeline.
- Missing rows are created automatically from tracked validators.
- Incident reconciliation reads this table, but no other worker writes it.

### validators_snapshot_balances

Fields move here from the old snapshot table:

- `validator_index`
- `balance`
- `effective_balance`
- `beacon_status`
- `updated_at`

Write rules:

- Written only by the current snapshot balances flow.
- Missing rows are created automatically from tracked validators.

### validators_snapshot_performance

Fields move here from the old snapshot table:

- hourly performance and reward fields
- daily performance and reward fields
- weekly performance and reward fields
- monthly performance and reward fields
- per-window attestation counters
- per-window attestation delay and efficiency fields
- `updated_at`

Write rules:

- Written only by the current snapshot performance flow.
- Missing rows are created automatically from tracked validators.

## Scheduling

Scheduling stays the same during this refactor.

- `validatorActivityStatus` continues to poll every slot.
- `snapshot` continues to poll on its current timer and internally decides when to refresh epoch, daily, weekly, and monthly levels.

The deadlock fix must come from removing the shared table, not from serializing the workers.

## PR Split

### PR 1: storage cutover

Purpose: deliver the actual reliability fix.

Scope:

- add the three `validators_snapshot_*` tables
- move all writes to the new tables
- stop using `validators_snapshot_stats`
- keep machine locations and names unchanged
- keep scheduling unchanged
- update tests around ownership and rebuild behavior

### PR 2: XState reorganization

Purpose: rename and regroup the snapshot-related machines without behavior changes.

Target structure:

- `packages/indexer/src/xstate/validatorsSnapshot/balancesPerformance.machine.ts`
- `packages/indexer/src/xstate/validatorsSnapshot/activity.machine.ts`
- `packages/indexer/src/xstate/validatorsSnapshot/index.ts`

Scope:

- move the existing snapshot machine into the new namespace
- move the existing validator activity machine into the new namespace
- rename factories and imports to match the new bounded context
- preserve the behavior shipped in PR 1

## Data Flow

### PR 1

- activity worker writes only `validators_snapshot_activity`
- snapshot worker writes only `validators_snapshot_balances`
- snapshot worker writes only `validators_snapshot_performance`
- no runtime path writes to a shared `validators_snapshot_*` table

### PR 2

- no storage changes
- no cadence changes
- only code organization and naming changes

## Error Handling

- Workers must tolerate missing snapshot rows by inserting them before update work.
- Empty snapshot tables are not treated as corruption.
- Worker restart should repopulate hot state from existing indexed data.
- Incident processing continues to use its current cursor and safe-slot logic.

## Testing Strategy

### PR 1

- schema and storage tests for the new tables
- snapshot tests that prove balances and performance writes no longer depend on `validators_snapshot_stats`
- validator activity tests that prove activity writes are isolated to `validators_snapshot_activity`
- regression coverage for automatic row creation in empty hot tables

### PR 2

- machine tests for renamed factories and machine wiring
- type-check and targeted runtime tests to prove no behavior change

## Risks

- API reads that still depend on `validators_snapshot_stats` will break after PR 1 until the API follow-up lands.
- Some SQL may still assume all snapshot fields live in one table and must be updated carefully.
- E2E fixtures may need to seed multiple snapshot tables instead of one.

## Recommendation

Proceed with a two-PR implementation.

- PR 1 changes persistence ownership and removes the deadlock source.
- PR 2 renames and reorganizes the XState snapshot domain after behavior is stable.
