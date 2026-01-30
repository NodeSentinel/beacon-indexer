# AGENTS.md — DB

This package holds the Prisma schema and migrations. Root project context: see repository root `AGENTS.md`.

**Storage read/write:** When implementing or changing anything that reads or writes time-series data (API endpoints, indexer storage), follow the data organization and dual-table pattern below. API and indexer packages reference this file for storage-related work.

## Two-tier storage

The database uses a **two-tier storage** model:

1. **Raw tables (temporary)**  
   Fine-grained events (one row per slot, epoch, attestation, etc.). Partitioned by time; partitions are created and deleted dynamically. Data is aggregated and **deleted** after archival (no duplication).

2. **Archive tables (permanent)**  
   Time-based aggregates (e.g. hourly, daily). Hybrid: aggregate columns plus JSON arrays with event detail. Partitioned by time; data is kept long-term.

There is a **moving boundary**: data older than the boundary exists only in archive tables; newer data only in raw tables. A control table stores the archival boundary timestamp.

## Partition naming

- **Raw:** `{table}_{start}-{end}_{yyyyMMddHH}` (e.g. `committee_500-1599_2024011510`). Events with slot/epoch in that range; suffix = UTC hour of partition creation.
- **Archive:** `{table}_{yyyyMMddHH}` (e.g. `validator_hourly_archive_2024011510`). One partition per UTC hour.

Discover partitions via PostgreSQL catalog; parse names to get time/slot ranges.

## Data structure

**Raw tables:** One row per event; direct relational queries (e.g. `WHERE slot = X AND validator_index = Y`).

**Archive tables:** One row per time period per entity; aggregate columns for filtering/summation; JSON arrays for original event detail. Query by timestamp and use JSON operations for event-level access.

## Dual-table pattern (read/write)

1. **Determine data location**  
   Read the control table for the archival boundary. Compare the requested time range:
   - Entirely older than boundary → archive only.
   - Entirely newer → raw only (ensure partitions exist).
   - Spanning boundary → use both.

2. **When spanning the boundary**
   - **Archive:** historical segment; aggregate columns and timestamp filters; JSON arrays for event detail.
   - **Raw:** recent segment; list/parse partitions for the range; relational filters on slot/epoch.
   - **Merge:** transform both sides to a single shape (e.g. expand archive JSON into event-like rows or aggregate raw to match archive), then merge with consistent ordering.
