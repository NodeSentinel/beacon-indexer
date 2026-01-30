# AGENTS.md

Instructions for AI coding agents working on this repository. Per-package guidance lives in each package's `AGENTS.md`; the closest file to the edited file wins ([AGENTS.md](https://agents.md/)).

## Project overview

This project is a lightweight beacon chain indexer for **Ethereum** and **Gnosis** beacon chains. It collects, normalizes, and processes validator-related data from the **Consensus Layer** via standard Beacon node APIs and enriches it with **Execution Layer** data when needed (e.g. Etherscan, Blockscout).

Core concepts: Validators, Slots and Blocks, Epochs, Committees, Attestations, Rewards/penalties. Data is sourced from the [Beacon API](https://ethereum.github.io/beacon-APIs/#/Beacon).

## Global setup

- Install deps: `pnpm install`
- Run all tests: `pnpm test`
- Lint: `pnpm lint`
- Type-check: `pnpm type-check`

## Global code style

- TypeScript for all code; prefer strict typing.
- Search existing code before adding new components or endpoints.
- Write comments in English. Do not add comments for temporary context, formatting preferences, or non-functional instructions.

## Database (project-wide)

- Beta mode: keep only the initial migration. Apply schema changes by updating the initial migration, not by adding new migrations.

## Packages

- **`packages/db`**: Prisma schema and migrations. See `packages/db/AGENTS.md` for data organization and dual-table storage.
- **`packages/indexer`**: Core indexing service. See `packages/indexer/AGENTS.md`.
- **`packages/api`**: REST/API layer. See `packages/api/AGENTS.md`.
- **`packages/app`**: Next.js frontend. See `packages/app/AGENTS.md`.
