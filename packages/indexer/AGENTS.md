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

## Business logic clarity

- When business logic is unclear, incomplete, or open to multiple reasonable
  interpretations, do not assume a path. Stop and ask before implementing.

## E2E tests

Location: `packages/indexer/e2e/`

### Running tests

- Run from repo root: `pnpm test:e2e:local`
- CI runs via `.github/workflows/e2e-indexer.yml`
- Tests run against real PostgreSQL (Docker container in CI)

### Test patterns

- Use real beacon chain data (Gnosis chain) stored as JSON mocks in `e2e/**/mocks/*.json`
- Mock `BeaconClient` methods with `vi.spyOn` to return JSON fixtures
- Prefer real blockchain data over fabricated test data for accuracy
- When existing mocks are insufficient, fetch real data from beacon chain and save as new JSON fixtures (ask to the user for help).

### Structure

```
e2e/
├── archive/          # Archive process tests
├── epoch/            # Epoch processing tests
│   └── mocks/        # JSON fixtures for epoch tests
├── slot/             # Slot processing tests
│   └── mocks/        # JSON fixtures for slot tests
└── validators/       # Validator tests
```

### When to update e2e tests

- Adding new XState machines or states
- Changing controller business logic
- Modifying storage layer queries
- Adding new cron jobs
