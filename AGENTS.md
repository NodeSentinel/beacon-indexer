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

### E2E Tests

Run e2e tests only from the repo root with `pnpm test:e2e:local`.
Never run e2e tests directly with package scripts, Vitest, `.env`, or custom DB credentials. If the root command cannot be used, stop and ask.

### E2E Test Documentation

Every end-to-end test must include clear comments explaining what the test does.

- Each test block (`describe`, `test`, `it`, etc.) should include a high-level comment describing the scenario being tested.
- Inside the test, every significant line or block should have a short comment explaining its purpose.

A developer should be able to fully understand the intent and flow of the test by reading the comments, without having to infer or guess behavior from the code itself.

## GitHub workflow

- When creating pull requests, do **not** prefix the title with `[codex]`.

## Best practices

- Every code block must include clear comments explaining its purpose. Comments should be sufficient for a developer to understand the logic without reading the code itself.
- Every function must have a short comment summarizing what it does.
- Comments must be simple, easy to understand, direct and describe the local code only.
- Write comments for developers reading the code for the first time. Comments must explain the local intent and context in plain language, including the reason for non-obvious control flow, state transitions, retries, batching, locking, or cleanup behavior.
- Do not write terse comments that merely restate a function name, describe syntax, or only make sense to the agent. If a new developer cannot understand why the code exists from the comment, rewrite it.
- Do not move chat context, refactor history, or temporary reasoning into durable code comments.
- Do not mix reusable helpers with feature logic. Move reusable formatting, parsing, calculation, or conversion helpers to a shared `utils` module with generic names and interfaces.

## Agent

- NEVER do changes without confirmation.
- Full filesystem/tool permissions do not imply permission to make product, architecture, workflow, security, infrastructure, environment, or repository-policy decisions without confirmation.
- If a decision could be controversial, surprising, hard to revert, or outside the exact requested scope, stop and ask before changing code.
- Always make sure the request is fully understood before implementing. If the intent, scope, or tradeoff is unclear, stop and ask instead of guessing.
- For complex tasks, organize work into small semantic commits. Each commit should represent one coherent change and be easy to review or revert.

## Communication

- Be brutally concise.
- Answer the exact question only.
- No preambles.
- No extra context.
- No alternatives unless asked.
- No "it depends" unless strictly necessary.
- State facts first.
- Then, if useful, add one supporting code reference.
