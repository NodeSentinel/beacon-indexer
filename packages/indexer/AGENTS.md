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

## Controller layer

- Controllers hold all business logic.
- Fetch data from external APIs (BeaconClient, ExecutionClient).
- Transform and validate data according to business rules.
- Coordinate between multiple storage classes when needed.
- Handle complex calculations (rewards, attestation delays, etc.) and decide what to fetch and when.

## Storage layer

- Only database operations: Prisma queries, transactions, raw SQL.
- No business logic, data transformation, or validation.
- No decisions about what to fetch or how to process it.
- Accept pre-processed data from controllers and store it as-is.
- Return raw database records; storage classes are thin DAOs around Prisma.
- When implementing or changing storage (read/write), follow data organization, partitions, and archival boundary in **`packages/db/AGENTS.md`**.

## E2E tests

- When changing indexer behavior, check whether e2e tests under `packages/indexer/e2e` need updates.
- Run e2e from **outside a sandbox**, from repo root: `pnpm test:e2e:local`.
