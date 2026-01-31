# AGENTS.md — Indexer

This package is the core indexing service: it fetches and processes beacon chain data. Root project context: see repository root `AGENTS.md`.

## Architecture: dependency flow

Follow this order: **XState → Controllers → Storage → Database**.

## XState layer

- State machines orchestrate workflow only.
- Manage state transitions, retries, delays, and error recovery.
- Delegate all business logic to controllers.
- Do not contain data transformation or business rules.
- Coordinate the sequence of operations, not the logic.

### Key machines

- **Epoch orchestrator**: Coordinates epoch processing, emits `EPOCH_PROCESSED` events.
- **Slot orchestrator**: Coordinates slot processing, emits `SLOT_PROCESSED` events.
- **Hourly archive**: Triggered by `EPOCH_PROCESSED`, archives raw data to hourly.
- **Daily/Weekly/Monthly archive**: Same pattern, cascade from previous tier.
- **Snapshot updater**: Updates `validators_snapshot_stats` based on processed data.

## Controller layer

- Controllers hold all business logic.
- Fetch data from external APIs (BeaconClient, ExecutionClient).
- Transform and validate data according to business rules.
- Coordinate between multiple storage classes when needed.
- Handle complex calculations (rewards, attestation delays, etc.).

## Storage layer

- Only database operations: Prisma queries, transactions, raw SQL.
- No business logic, data transformation, or validation.
- Accept pre-processed data from controllers and store it as-is.
- **Use raw SQL** for performance-critical operations.
- For data organization, partitions, and archival, see **`packages/db/AGENTS.md`**.

## E2E tests

- When changing indexer behavior, check whether e2e tests under `packages/indexer/e2e` need updates.
- Run e2e from **outside a sandbox**, from repo root: `pnpm test:e2e:local`.
