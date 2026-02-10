---
date: 2026-02-10T14:42:16Z
researcher: claude
git_commit: 520c73d61782099dc1cf6b3e135a06c5cff723d8
branch: main
repository: beacon-chain-validators-monitor
topic: '[DB] Add chain_epoch_stats table (#64)'
tags: [research, codebase, db, chain-stats, prisma, schema]
status: complete
last_updated: 2026-02-10
last_updated_by: claude
---

# Research: [DB] Add chain_epoch_stats table (#64)

**Date**: 2026-02-10T14:42:16Z
**Researcher**: claude
**Git Commit**: 520c73d61782099dc1cf6b3e135a06c5cff723d8
**Branch**: main
**Repository**: beacon-chain-validators-monitor

## Research Question

What is the current state of the `packages/db` package and what is needed to implement GitHub issue #64 — adding the `chain_epoch_stats` table as part of Epic #52 (Chain Statistics)?

## Summary

Issue #64 requires adding a new `ChainEpochStats` Prisma model to `packages/db/prisma/schema.prisma` and updating the migrations. The model stores per-epoch chain-wide statistics (total active validators, total staked, entering/exiting/consolidating counts). The schema definition is already specified in `idea.md` (lines 94–107). The database currently has 23 models and 2 migrations. The new table is a simple non-partitioned, non-relational table keyed by epoch.

## Detailed Findings

### 1. Issue Context

**Epic #52 — Chain Statistics** ([GitHub](https://github.com/NodeSentinel/beacon-chain-validators-monitor/issues/52)) defines a chain statistics feature with 4 sub-tasks:

1. **[DB] Add chain_epoch_stats table** ← Issue #64 (this task)
2. [Indexer] Chain stats job (writes on EPOCH_PROCESSED)
3. [API] Chain stats endpoint
4. [App] Chain statistics component

The indexer will write to this table at the end of each epoch. The API reads directly from it — no aggregation at query time.

**Issue #64** ([GitHub](https://github.com/NodeSentinel/beacon-chain-validators-monitor/issues/64)) specifies:

- Add the `ChainEpochStats` model to `schema.prisma`
- Update the initial migration (beta mode — single migration)
- Acceptance: `pnpm db:generate` and `pnpm type-check` pass

### 2. Reference Schema from idea.md

[`idea.md:94-107`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/520c73d61782099dc1cf6b3e135a06c5cff723d8/idea.md#L94-L107):

```prisma
model ChainEpochStats {
  epoch                   Int    @id @map("epoch")
  totalActiveValidators   Int    @map("total_active_validators")
  totalStaked             BigInt @map("total_staked") // sum of effective balances
  validatorsEntering      Int    @map("validators_entering") // pending activation
  validatorsExiting       Int    @map("validators_exiting") // pending exit
  validatorsConsolidating Int    @map("validators_consolidating")

  @@map("chain_epoch_stats")
}
```

### 3. Current Database Schema State

[`packages/db/prisma/schema.prisma`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/520c73d61782099dc1cf6b3e135a06c5cff723d8/packages/db/prisma/schema.prisma) currently has **23 models**. The `ChainEpochStats` model does **not** yet exist.

Key conventions observed in the existing schema:

- **camelCase** Prisma model field names
- **snake_case** table/column names via `@map` / `@@map`
- `@id` for primary keys, composite keys via `@@id([...])`
- `BigInt` type for balances and monetary amounts
- No `createdAt`/`updatedAt` on data tables (only on user-facing tables)

The new model follows these conventions exactly.

### 4. Current Migration State

Two migrations exist:

1. **`20251210144216_initial`** — Full schema creation (all 23 tables, enums, indexes, foreign keys, partitioned tables)
   - [`packages/db/prisma/migrations/20251210144216_initial/migration.sql`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/520c73d61782099dc1cf6b3e135a06c5cff723d8/packages/db/prisma/migrations/20251210144216_initial/migration.sql)

**Note on migration strategy**: `AGENTS.md` states "Beta mode: Keep only the initial migration" but a second migration already exists. The issue #64 text says "Update initial migration (beta mode – single migration)" which would mean folding the new table into the initial migration SQL.

### 5. API Context

[`packages/api/AGENTS.md:26`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/520c73d61782099dc1cf6b3e135a06c5cff723d8/packages/api/AGENTS.md#L26) already documents the planned endpoint:

```
GET /chain/stats → Reads from chain_epoch_stats table.
```

This confirms the table is expected by downstream packages.

### 6. Package Scripts

Relevant scripts from [`packages/db/package.json`](https://github.com/NodeSentinel/beacon-chain-validators-monitor/blob/520c73d61782099dc1cf6b3e135a06c5cff723d8/packages/db/package.json):

| Script            | Command                                              |
| ----------------- | ---------------------------------------------------- |
| `prisma:generate` | `prisma generate --schema prisma/schema.prisma`      |
| `db:migrate`      | `prisma migrate dev --schema prisma/schema.prisma`   |
| `db:reset`        | `prisma migrate reset --schema prisma/schema.prisma` |
| `type-check`      | `tsc --noEmit`                                       |

Root-level equivalents use `pnpm --filter @beacon-indexer/db` and a `scripts/setDbUrl.js` wrapper.

### 7. Model Characteristics

The `ChainEpochStats` model is straightforward compared to most existing models:

- **Not partitioned** — Unlike `committee`, `epoch_rewards`, or `validator_hourly_archive`
- **No relationships** — Standalone table, no foreign keys
- **No JSON fields** — All columns are simple scalar types
- **Simple primary key** — Single `epoch` integer as `@id`
- **No processing flags** — Unlike `Epoch` or `Slot` models which track processing state

It most closely resembles the `IndexerConfig` model in simplicity (singleton-like with `@id`), but is keyed per-epoch rather than being a singleton.

## Code References

- `idea.md:94-107` — ChainEpochStats schema definition
- `packages/db/prisma/schema.prisma` — Current Prisma schema (model to be added here)
- `packages/db/prisma/migrations/20251210144216_initial/migration.sql` — Initial migration (to be updated)
- `packages/db/AGENTS.md` — Database conventions and migration strategy
- `packages/api/AGENTS.md:26` — Planned `GET /chain/stats` endpoint referencing this table
- `packages/db/package.json:18-29` — DB package scripts

## Architecture Documentation

### Table Design Pattern

The `chain_epoch_stats` table follows the "computed summary" pattern already seen in `ValidatorsSnapshotStats` — a table that stores pre-computed results to avoid expensive aggregation at query time. The indexer writes once per epoch; the API reads the latest row.

### Naming Convention

- Prisma model: `ChainEpochStats` (PascalCase)
- Table name: `chain_epoch_stats` (snake_case via `@@map`)
- Column names: snake_case via `@map` on each field

### Migration Approach

The issue specifies updating the initial migration (beta mode). This means:

1. Add `CREATE TABLE` SQL to the initial migration file
2. Add the model to `schema.prisma`
3. The migration history would need to be consistent (either reset or the SQL added must match what Prisma expects)

## Historical Context (from thoughts/)

No existing thought documents were found related to chain statistics or this issue.

## Related Research

No prior research documents exist in `thoughts/shared/research/`.

## Open Questions

1. **Migration strategy clarification**: The issue says "update initial migration (beta mode)" but a second migration already exists (`20260202120000_add_cluster_fee_recipient`). Should the new table be added as a third migration, or should it be folded into the initial migration requiring a DB reset?
