# [DB] Add chain_epoch_stats table (#64) — Implementation Plan

## Overview

Add the `ChainEpochStats` Prisma model to `packages/db` to store per-epoch chain-wide statistics. This is issue #64, the first sub-task of Epic #52 (Chain Statistics). The table will be written to by the indexer at the end of each epoch and read by the API via `GET /chain/stats`.

## Current State Analysis

- **23 models** exist in `packages/db/prisma/schema.prisma`
- **1 migration** exists (`20251210144216_initial`) — beta mode, single migration
- The `ChainEpochStats` model does **not** yet exist
- The schema definition is fully specified in `idea.md:94-107`

### Key Discoveries:

- Model is simple: non-partitioned, no relationships, no JSON fields, single `epoch` integer PK (`idea.md:94-107`)
- Follows the "computed summary" pattern like `ValidatorsSnapshotStats` (`schema.prisma:311-322`)
- Downstream consumer already planned: `GET /chain/stats` (`packages/api/AGENTS.md:26`)
- Beta mode confirmed: single initial migration (`packages/db/AGENTS.md:5`, commit `82f0b2c`)

## Desired End State

- `ChainEpochStats` model exists in `schema.prisma` in the aggregation/stats section (after `ValidatorsSnapshotStats`)
- `CREATE TABLE chain_epoch_stats` SQL exists in the initial migration file
- `pnpm prisma:generate` succeeds (Prisma client includes `ChainEpochStats`)
- `pnpm type-check` passes in `packages/db`

## What We're NOT Doing

- Not implementing the indexer job that writes to this table (that's issue #65 or similar)
- Not implementing the API endpoint (that's a separate sub-task of Epic #52)
- Not adding indexes beyond the primary key (epoch lookups by PK are sufficient)
- Not adding relationships or foreign keys (standalone table)

## Implementation Approach

Single phase — add the model to schema and update the migration.

## Phase 1: Add ChainEpochStats Model and Migration

### Overview

Add the Prisma model and the corresponding SQL to the initial migration.

### Changes Required:

#### 1. Prisma Schema

**File**: `packages/db/prisma/schema.prisma`
**Changes**: Add `ChainEpochStats` model after `ValidatorsSnapshotStats` (after line 322), before the `// API` section.

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

#### 2. Initial Migration SQL

**File**: `packages/db/prisma/migrations/20251210144216_initial/migration.sql`
**Changes**: Add `CREATE TABLE` statement after the `validators_status_summary` table (after line 227), before the `user` table.

```sql
-- CreateTable
CREATE TABLE "public"."chain_epoch_stats" (
    "epoch" INTEGER NOT NULL,
    "total_active_validators" INTEGER NOT NULL,
    "total_staked" BIGINT NOT NULL,
    "validators_entering" INTEGER NOT NULL,
    "validators_exiting" INTEGER NOT NULL,
    "validators_consolidating" INTEGER NOT NULL,

    CONSTRAINT "chain_epoch_stats_pkey" PRIMARY KEY ("epoch")
);
```

### Success Criteria:

#### Automated Verification:

- [x] Prisma client generates successfully: `pnpm --filter @beacon-indexer/db prisma:generate`
- [x] Type checking passes: `pnpm --filter @beacon-indexer/db type-check`
- [x] Full workspace type-check passes: `pnpm type-check`

#### Manual Verification:

- [x] Model appears in generated Prisma client types
- [x] Schema diff between Prisma schema and migration SQL is consistent (no drift)

## Testing Strategy

No dedicated tests needed for this change — it's a schema-only addition. Verification is through Prisma generation and type-checking.

## References

- GitHub Issue: #64
- Epic: #52 (Chain Statistics)
- Research: `thoughts/shared/research/2026-02-10-64-chain-epoch-stats-table.md`
- Schema spec: `idea.md:94-107`
- Existing schema: `packages/db/prisma/schema.prisma`
- Migration: `packages/db/prisma/migrations/20251210144216_initial/migration.sql`
- DB conventions: `packages/db/AGENTS.md`
