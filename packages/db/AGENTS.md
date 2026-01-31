# AGENTS.md — DB

This package holds the Prisma schema and migrations. Root project context: see repository root `AGENTS.md`.

## Naming conventions

- **camelCase** for Prisma model names (e.g., `ValidatorHourlyArchive`).
- **snake_case** for table names via `@@map` (e.g., `validator_hourly_archive`).
- Always use `@@map` to set explicit table names.

## Two-tier storage

The database uses a **two-tier storage** model:

1. **Raw tables (temporary)**
   Fine-grained events (one row per slot, epoch, attestation, etc.). Partitioned by time; partitions are created and deleted dynamically. Data is aggregated and **deleted** after archival (no duplication).

2. **Archive tables (permanent)**
   Time-based aggregates (e.g., hourly, daily, weekly, monthly). Hybrid: aggregate columns plus JSON arrays with event detail. Partitioned by time; data is kept long-term.

There is a **moving boundary**: data older than the boundary exists only in archive tables; newer data only in raw tables. The `Archive` control table stores the archival boundary timestamps (`lastHour`, `lastDay`, `lastWeek`, `lastMonth`).

### Archival cascade

- **Raw → Hourly**: Keep ~60 min of raw data, archive older.
- **Hourly → Daily**: Keep ~24h of hourly archives, archive older to daily.
- **Daily → Weekly**: Keep ~7 days of daily archives, archive older to weekly.
- **Daily → Monthly**: Keep ~30 days of daily archives, archive older to monthly.

**Atomic transactions**: Archiving and deleting source data happen in the same transaction. Never have duplicated data.

## Partition naming

- **Raw:** `{table}_{start}-{end}_{yyyyMMddHH}` (e.g., `committee_500-1599_2024011510`). Events with slot/epoch in that range; suffix = UTC hour of partition creation.
- **Archive:** `{table}_{yyyyMMddHH}` (e.g., `validator_hourly_archive_2024011510`). One partition per UTC hour.

Discover partitions via PostgreSQL catalog; parse names to get time/slot/epoch ranges.

**Partitioned tables:**

- `committee`: partitioned by slot
- `epoch_rewards`: partitioned by epoch
- `validator_hourly_archive`: partitioned by timestamp
- `validator_daily_archive`: partitioned by timestamp (to be created)
- `validator_weekly_archive`: partitioned by timestamp (to be created)
- `validator_monthly_archive`: partitioned by timestamp (to be created)

## Data structure

**Raw tables:** One row per event; direct relational queries (e.g., `WHERE slot = X AND validator_index = Y`).

**Archive tables:** One row per time period per entity; aggregate columns for filtering/summation; JSON arrays for original event detail. Query by timestamp and use JSON operations for event-level access.
