# Validators Snapshot Hot State Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the shared validator snapshot hot table into worker-owned tables, then reorganize the XState snapshot code into a `validatorsSnapshot` bounded context.

**Architecture:** PR 1 keeps existing scheduling and machine wiring but moves all writes from `validators_snapshot_stats` into `validators_snapshot_activity`, `validators_snapshot_balances`, and `validators_snapshot_performance`. PR 2 is a pure code-organization change that moves the snapshot and activity machines into `xstate/validatorsSnapshot` with clearer names.

**Tech Stack:** TypeScript, Prisma, PostgreSQL raw SQL, XState, Vitest, GitHub PR workflow

---

## File Map

### PR 1

**Create**
- `packages/db/prisma/migrations/<timestamp>_split_validators_snapshot_hot_state/migration.sql`

**Modify**
- `packages/db/prisma/schema.prisma`
- `packages/indexer/src/services/consensus/storage/snapshot.ts`
- `packages/indexer/src/services/consensus/storage/validatorActivityStatus.ts`
- `packages/indexer/e2e/**` snapshot and activity tests that seed or read hot state
- any test helpers that currently assume `validators_snapshot_stats`

### PR 2

**Create**
- `packages/indexer/src/xstate/validatorsSnapshot/balancesPerformance.machine.ts`
- `packages/indexer/src/xstate/validatorsSnapshot/activity.machine.ts`
- `packages/indexer/src/xstate/validatorsSnapshot/index.ts`

**Modify**
- `packages/indexer/src/xstate/index.ts`
- `packages/indexer/src/index.ts`
- tests for the moved machines

**Delete**
- old machine files under `packages/indexer/src/xstate/snapshot/` and `packages/indexer/src/xstate/validatorActivityStatus/` after the new files are in place

### Task 1: Lock The PR 1 Storage Cutover In Tests

**Files:**
- Modify: `packages/indexer/e2e/snapshot/snapshot.test.ts`
- Modify: `packages/indexer/e2e/validatorActivityStatus/validatorActivityStatus.test.ts`
- Modify: test helpers that seed snapshot rows

- [ ] Write failing tests that seed the new `validators_snapshot_*` tables instead of `validators_snapshot_stats`.
- [ ] Run the focused snapshot and validator activity tests and confirm they fail because production code still targets the old table.
- [ ] Update the tests so they assert worker ownership:
  - balances writes land in `validators_snapshot_balances`
  - performance writes land in `validators_snapshot_performance`
  - activity writes land in `validators_snapshot_activity`
- [ ] Re-run the focused tests and confirm the failures point at the missing implementation.
- [ ] Commit the test-only red state for PR 1.

### Task 2: Add The New Hot Tables And Remove The Shared Table

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_split_validators_snapshot_hot_state/migration.sql`

- [ ] Write the failing schema expectations in the affected tests or schema validation flow.
- [ ] Run the focused validation command and confirm the schema is still missing the new tables.
- [ ] Add Prisma models for:
  - `validators_snapshot_activity`
  - `validators_snapshot_balances`
  - `validators_snapshot_performance`
- [ ] Remove the Prisma model for `validators_snapshot_stats`.
- [ ] Write the migration that drops the old hot table and creates the three new tables with matching ownership boundaries.
- [ ] Run Prisma validation and any generated type step used by the repo.
- [ ] Commit the schema cutover.

### Task 3: Move Snapshot Writes To Balances And Performance Tables

**Files:**
- Modify: `packages/indexer/src/services/consensus/storage/snapshot.ts`
- Modify: related snapshot tests

- [ ] Run the focused snapshot tests in the red state and capture the exact old-table failures.
- [ ] Add helper SQL in `snapshot.ts` that ensures missing rows exist in:
  - `validators_snapshot_balances`
  - `validators_snapshot_performance`
- [ ] Update `updateBalances()` to write only `validators_snapshot_balances`.
- [ ] Update `updatePerformanceH()`, `updatePerformanceD()`, `updatePerformanceW()`, and `updatePerformanceM()` to write only `validators_snapshot_performance`.
- [ ] Update new-validator backfill logic so it inserts missing rows into both owned tables.
- [ ] Re-run the focused snapshot tests and make them pass.
- [ ] Commit the snapshot storage cutover.

### Task 4: Move Activity Writes To validators_snapshot_activity

**Files:**
- Modify: `packages/indexer/src/services/consensus/storage/validatorActivityStatus.ts`
- Modify: related activity and incident tests

- [ ] Run the focused validator activity tests in the red state and capture the old-table failures.
- [ ] Add helper SQL in `validatorActivityStatus.ts` that ensures missing rows exist in `validators_snapshot_activity`.
- [ ] Replace reads and writes that currently target `validators_snapshot_stats` so they use `validators_snapshot_activity`.
- [ ] Keep incident reconciliation logic working by reading the new activity table instead of the old shared table.
- [ ] Re-run the focused activity and incident tests and make them pass.
- [ ] Commit the activity storage cutover.

### Task 5: Verify PR 1 And Open The First Pull Request

**Files:**
- Verify the full PR 1 diff only

- [ ] Run the relevant test commands for snapshot, validator activity, incidents, type-check, and any package-specific verification needed by the touched code.
- [ ] Review the diff for accidental folder reorganization or behavior changes outside the storage cutover.
- [ ] Create branch `feat/validators-snapshot-hot-state-split`.
- [ ] Commit any remaining PR 1 changes with a focused message.
- [ ] Push the branch and open PR 1 against `main`.

### Task 6: Lock The PR 2 Rename In Tests

**Files:**
- Modify: `packages/indexer/src/xstate/snapshot/*.test.ts`
- Modify: `packages/indexer/src/xstate/validatorActivityStatus/*.test.ts`
- Modify: wiring tests that import actor factories

- [ ] Write failing tests or import updates that target the new `xstate/validatorsSnapshot` module structure.
- [ ] Run the focused machine tests and confirm they fail because the new module paths do not exist yet.
- [ ] Keep assertions behavior-identical to PR 1 so PR 2 stays a pure organization change.
- [ ] Commit the PR 2 red state if it helps review, otherwise keep it local until green.

### Task 7: Move Snapshot Machines Into xstate/validatorsSnapshot

**Files:**
- Create: `packages/indexer/src/xstate/validatorsSnapshot/balancesPerformance.machine.ts`
- Create: `packages/indexer/src/xstate/validatorsSnapshot/activity.machine.ts`
- Create: `packages/indexer/src/xstate/validatorsSnapshot/index.ts`
- Modify: `packages/indexer/src/xstate/index.ts`
- Modify: `packages/indexer/src/index.ts`
- Delete: old machine files after imports are updated

- [ ] Copy the current snapshot machine into `balancesPerformance.machine.ts` without changing runtime behavior.
- [ ] Copy the current validator activity machine into `activity.machine.ts` without changing runtime behavior.
- [ ] Add the new `validatorsSnapshot/index.ts` actor factories and exports.
- [ ] Update runtime wiring in `packages/indexer/src/xstate/index.ts` and `packages/indexer/src/index.ts`.
- [ ] Rename logger labels only if needed for clarity and only when tests still reflect unchanged behavior.
- [ ] Delete the old machine files once imports point at the new module.
- [ ] Re-run the focused machine tests and make them pass.
- [ ] Commit the XState reorganization.

### Task 8: Verify PR 2 And Open The Second Pull Request

**Files:**
- Verify the PR 2 diff on top of PR 1 only

- [ ] Run the relevant machine tests, indexer type-check, and any smoke tests needed to prove the rename did not change behavior.
- [ ] Review the diff for unintended storage changes in PR 2.
- [ ] Create branch `refactor/validators-snapshot-xstate-context` from the PR 1 branch.
- [ ] Commit any remaining PR 2 changes with a focused message.
- [ ] Push the branch and open PR 2 against the PR 1 branch.

## Self-Review

- PR 1 covers the schema cutover, snapshot writer cutover, activity writer cutover, and verification.
- PR 2 covers only the XState namespace and factory rename.
- The plan keeps the reliability fix isolated from the folder move.
