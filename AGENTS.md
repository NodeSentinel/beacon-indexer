# AGENTS.md

Instructions for AI coding agents working on this repository. Per-package guidance lives in each package's `AGENTS.md`; the closest file to the edited file wins ([AGENTS.md](https://agents.md/)).

## Purpose of AGENTS.md

This project uses AGENTS.md files to provide context to AI agents. The goal is that in the future, you can request features or bugfixes **without explaining how things work** - just describe the feature/problem, and the agent has sufficient context.

**When completing tasks:**

- Update AGENTS.md if you learn something relevant that would help future agents.
- Add domain knowledge, architectural decisions, gotchas, and patterns.
- Keep it concise and actionable.
- Respect scope: storage details go in `packages/db/AGENTS.md`, indexer logic in `packages/indexer/AGENTS.md`, etc.

## Project overview

**NodeSentinel** is a lightweight beacon chain indexer and monitoring platform for **Ethereum** and **Gnosis** beacon chains. It collects, normalizes, and processes validator-related data from the **Consensus Layer** via standard Beacon node APIs and enriches it with **Execution Layer** data when needed.

### Deployment model

- **Single-chain per instance**: Each deployment works with one chain (Ethereum or Gnosis), configured via environment variables.
- The codebase is the same for both chains.

### Core features

- Real-time validator monitoring dashboard
- Cluster-based validator grouping (User → Clusters → Validators)
- Performance metrics (attestations, rewards, APY)
- Event tracking (blocks, deposits, withdrawals, consolidations, incidents)
- Telegram bot alerts

## Beacon chain domain

Core concepts: Validators, Slots and Blocks, Epochs, Committees, Attestations, Rewards/penalties. Data is sourced from the [Beacon API](https://ethereum.github.io/beacon-APIs/#/Beacon).

### Validator participation rhythms

- **Attestation committees**: Validators attest **once per epoch** (one slot per epoch, roughly one per 32 slots).
- **Sync committee**: A fixed set serves for **256 epochs**, participating in **every slot** during that period.
- **Block proposals**: Rare, random assignment. High reward when it happens.

### Tokens by chain

- **Mainnet**: Consensus rewards in ETH, Execution rewards in ETH
- **Gnosis**: Consensus rewards in GNO, Execution rewards in DAI

## Data architecture

### Clusters model

```
User → n Clusters → n Validators (via ClusterValidator)
```

- No direct User → Validator relationship. Everything goes through clusters.
- A validator can be in multiple clusters of the same user.
- Clusters are private by default, with option to share.

### Storage

For data organization (raw tables, archives, snapshots, partitioning), see **`packages/db/AGENTS.md`**.

## Task separation

When implementing features that span multiple packages:

- Create **separate PRs per layer** (indexer, API, UI).
- Each PR is atomic with its own tests.
- Don't mix layers in the same PR.

## Global setup

- Install deps: `pnpm install`
- Run all tests: `pnpm test`
- Run e2e tests: `pnpm test:e2e:local`
- Lint: `pnpm lint`
- Type-check: `pnpm type-check`

## Testing strategy

### Unit tests

- Test individual functions and classes in isolation
- Mock external dependencies

### E2E tests

- Test complete flows against real PostgreSQL
- Use real beacon chain data (JSON fixtures) for accuracy
- CI runs e2e tests via GitHub Actions workflows
- See package-specific AGENTS.md for e2e patterns

## Global code style

- TypeScript for all code; prefer strict typing.
- Search existing code before adding new components or endpoints.
- Write comments in English. No temporary or non-functional comments.
- **camelCase** for Prisma models.
- **snake_case** for table names (via `@@map`).
- Raw SQL for performance-critical queries, not Prisma models.

## Database (project-wide)

- Beta mode: keep only the initial migration. Apply schema changes by updating the initial migration, not by adding new migrations.

## Packages

- **`packages/db`**: Prisma schema and migrations. See `packages/db/AGENTS.md` for data organization.
- **`packages/consensus-utils`**: Shared beacon chain utilities (BeaconTime, chain config, validator status types).
- **`packages/indexer`**: Core indexing service. See `packages/indexer/AGENTS.md`.
- **`packages/api`**: REST/API layer. See `packages/api/AGENTS.md`.
- **`packages/app`**: Next.js frontend. See `packages/app/AGENTS.md`.
- **`packages/telegram-bot`**: Telegram bot for alerts.
