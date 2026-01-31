# AGENTS.md — API

This package is the API layer that exposes indexed data. Root project context: see repository root `AGENTS.md`.

The API supports **both REST and RPC** implemented with **oRPC**; any new procedures or routes must be exposed on both transports.

## Setup and run

- From repo root: `pnpm dev:api` or `pnpm build:api`.
- From this package: `pnpm dev` (development server).

## API role

The API is a **thin layer** that:

- Reads from database.
- Validates inputs with Zod.
- Returns data to clients.

**The API does NOT run cron jobs.** All background processing happens in the Indexer.

## Key endpoints

### Chain Stats

- `GET /chain/stats` → Reads from `chain_epoch_stats` table.

### Clusters (CRUD)

- `POST /clusters` → Create cluster
- `GET /clusters` → List user's clusters
- `PUT /clusters/:id` → Update name/visibility
- `DELETE /clusters/:id` → Delete cluster
- `POST /clusters/:id/validators` → Add validators
- `DELETE /clusters/:id/validators/:validatorIndex` → Remove validator

### Dashboard Stats

- `GET /clusters/:id/stats` → Aggregated stats for cluster
- `GET /clusters/all/stats` → All clusters for user

When querying "all clusters", sum all validators from all user's clusters via `ClusterValidator`.

### Events (paginated, by type)

- `GET /clusters/:id/events/blocks`
- `GET /clusters/:id/events/deposits`
- `GET /clusters/:id/events/withdrawals`
- `GET /clusters/:id/events/consolidations`
- `GET /clusters/:id/events/incidents`

Same pattern for individual validators:

- `GET /validators/:index/events/blocks`
- etc.

### Pagination

Only use pagination for UI listings (validators, events, history). Stats aggregates always sum all validators in the cluster.

## Backend conventions

- Validate all inputs with Zod.
- **Use raw SQL** for performance-critical queries, not Prisma models.

## Storage

For data organization, table structure, and query patterns, see **`packages/db/AGENTS.md`**.

## E2E tests

Location: `packages/api/e2e/` (to be created)

### Pattern (follow indexer approach)

- Tests run against real PostgreSQL (Docker container in CI)
- CI workflow at `.github/workflows/e2e-api.yml`
- See `packages/indexer/e2e/` and `.github/workflows/e2e-indexer.yml` as reference

## Design document

See `idea.md` in the repository root for complete endpoint specifications.
