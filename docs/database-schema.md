# Database Schema Guide

## Schema Location

`packages/db/prisma/schema.prisma` — Single Prisma schema file.
Single initial migration: `packages/db/prisma/migrations/20251210144216_initial/migration.sql`.

## Naming Conventions

- **Prisma models**: PascalCase (e.g., `ChainEpochStats`)
- **Table names**: snake_case via `@@map` (e.g., `chain_epoch_stats`)
- **Prisma fields**: camelCase (e.g., `totalActiveValidators`)
- **DB columns**: snake_case via `@map` (e.g., `total_active_validators`)

## Key Tables

### Core Data Tables

| Model          | Table           | PK                                    | Partitioned | Purpose                                                 |
| -------------- | --------------- | ------------------------------------- | ----------- | ------------------------------------------------------- |
| `Validator`    | `validator`     | `id` (validator index)                | No          | Current validator state (status, balance, pubkey, etc.) |
| `Epoch`        | `epoch`         | `epoch`                               | No          | Epoch tracking with processing flags                    |
| `Slot`         | `slot`          | `slot`                                | No          | Slot tracking with processing flags                     |
| `Committee`    | `committee`     | `(slot, index, aggregationBitsIndex)` | By slot     | Attestation data per committee member                   |
| `epochRewards` | `epoch_rewards` | `(epoch, validatorIndex)`             | By epoch    | Per-validator epoch rewards                             |

### Archive Tables

| Model                      | Table                         | Partitioned By | Purpose                                                        |
| -------------------------- | ----------------------------- | -------------- | -------------------------------------------------------------- |
| `ValidatorHourlyArchive`   | `validator_hourly_archive`    | timestamp      | Hourly aggregated validator data                               |
| `ValidatorDailyArchive`    | `validator_daily_archive`     | timestamp      | Daily aggregated validator data                                |
| `ValidatorMonthlyArchive`  | `validator_monthly_archive`   | timestamp      | Monthly aggregated validator data                              |
| `Archive`                  | `archive`                     | —              | Control table: tracks archival boundaries (`lastHour`, etc.)   |
| `ArchiveHourMergeProgress` | `archive_hour_merge_progress` | —              | Progress table for hourly-to-daily incremental archive batches |

### Execution Request Tables

| Model                             | Table                              | PK                                   | Purpose                       |
| --------------------------------- | ---------------------------------- | ------------------------------------ | ----------------------------- |
| `validatorConsolidationsRequests` | `validator_request_consolidations` | `(slot, sourcePubkey, targetPubkey)` | Consolidation events per slot |
| `validatorRequestWithdrawals`     | `validator_request_withdrawals`    | `(slot, pubKey)`                     | Withdrawal requests per slot  |

### Statistics Tables

| Model                     | Table                       | PK      | Purpose                                                                      |
| ------------------------- | --------------------------- | ------- | ---------------------------------------------------------------------------- |
| `ChainEpochStats`         | `chain_epoch_stats`         | `epoch` | Per-epoch chain-wide statistics snapshot (written by `ChainStatsController`) |
| `ValidatorsSnapshotStats` | `validators_status_summary` | —       | Current validator status/performance summary                                 |

### User/Cluster Tables

```
User → n Clusters → n Validators (via ClusterValidator)
```

No direct User → Validator relationship. Everything goes through clusters.

## Partition Naming

- **Raw partitions**: `{table}_{start}-{end}_{yyyyMMddHH}` (e.g., `committee_500-1599_2024011510`)
- **Archive partitions**: `{table}_{yyyyMMddHH}` (e.g., `validator_hourly_archive_2024011510`)
- Discovered via PostgreSQL catalog (`pg_class`, `pg_inherits`)
- Parsing utilities: `packages/indexer/src/services/consensus/controllers/helpers/partitionNaming.ts`

## Important Details

- `Validator.status` is `Int?` (nullable) with an index. Null status validators are treated as attesting/active in some queries.
- `Validator.effectiveBalance` is `BigInt?` — used for staking calculations.
- `ChainEpochStats` is NOT partitioned — stores one row per epoch indefinitely.
- `Slot` table has many boolean flags tracking what data has been fetched (`attestationsFetched`, `erConsolidationsFetched`, etc.).
- `Archive.lastHour` tracks raw-to-hourly archive progress only.
- Hourly-to-daily archive progress is tracked in `ArchiveHourMergeProgress` and each batch is committed atomically.
