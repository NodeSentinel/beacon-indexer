## Project overview

**NodeSentinel** is a lightweight beacon chain indexer and monitoring platform for **Ethereum** and **Gnosis** beacon chains. It collects, normalizes, and processes validator-related data from the **Consensus Layer** via standard Beacon node APIs and enriches it with **Execution Layer** data when needed.

## Packages

- **`packages/db`**: Prisma schema and migrations. See `packages/db/AGENTS.md` for data organization and storage.
- **`packages/beacon-utils`**: Shared beacon chain utilities (BeaconTime, chain config, validator status types).
- **`packages/indexer`**: Core indexing service. See `packages/indexer/AGENTS.md`.
- **`packages/api`**: REST/API layer. See `packages/api/AGENTS.md`.
- **`packages/webapp`**: Next.js frontend. See `packages/webapp/AGENTS.md`.
- **`packages/telegram-bot`**: Telegram bot for alerts.

## Global setup

- Install deps: `pnpm install`
- Run all tests: `pnpm test`
- Run e2e tests: `pnpm test:e2e:local` (from outside of a sandbox)
- Lint: `pnpm lint`
- Type-check: `pnpm type-check` is defined in the root and also on each package.

## Docs

- **`docs`**: project docs. See `docs/`.

### E2E Test Documentation

Every end-to-end test must include clear comments explaining what the test does.

- Each test block (`describe`, `test`, `it`, etc.) should include a high-level comment describing the scenario being tested.
- Inside the test, every significant line or block should have a short comment explaining its purpose.

A developer should be able to fully understand the intent and flow of the test by reading the comments, without having to infer or guess behavior from the code itself.

## GitHub workflow

- When creating pull requests, do **not** prefix the title with `[codex]`.
