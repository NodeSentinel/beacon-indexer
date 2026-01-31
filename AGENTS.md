# AGENTS.md

Instructions for AI coding agents working on this repository. Per-package guidance lives in each package's `AGENTS.md`; the closest file to the edited file wins ([AGENTS.md](https://agents.md/)).

## Project overview

This project is a lightweight beacon chain indexer for **Ethereum** and **Gnosis** beacon chains. It collects, normalizes, and processes validator-related data from the **Consensus Layer** via standard Beacon node APIs and enriches it with **Execution Layer** data when needed (e.g. Etherscan, Blockscout).

Core concepts: Validators, Slots and Blocks, Epochs, Committees, Attestations, Rewards/penalties. Data is sourced from the [Beacon API](https://ethereum.github.io/beacon-APIs/#/Beacon).

## Beacon chain domain (project-wide)

Validator participation has different rhythms depending on duty type. When designing queries, timelines, or aggregations that mix multiple duty types, account for these differences.

- **Attestation committees**: Validators are assigned to attestation committees per epoch. Each validator attests **once per epoch** (one slot per epoch, i.e. roughly one slot per 32 slots). Storage keyed by attestation (e.g. one row per attestation slot per validator) therefore has ~1 row per epoch per validator.
- **Sync committee**: A fixed set of validators serves for a **sync committee period** (256 epochs). During that period they participate in **every slot** (sign the sync aggregate and may receive sync committee reward). So sync committee participation is **every slot** for the period (~256 slots per validator per period), not once per epoch.
- **Implication**: Any result set or timeline that is **driven by attestation slots** (committee rows) will only include sync committee data when the same slot is both an attestation slot and a sync committee slot. Slots where the validator only had sync committee duty will not appear in attestation-centric views. Aggregations or UIs that must reflect both attestation and sync committee activity need to either union/join with sync-committee data or use a slot source that includes all relevant slots.

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
