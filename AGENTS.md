## Project overview

**NodeSentinel** is a lightweight beacon chain indexer and monitoring platform for **Ethereum** and **Gnosis** beacon chains. It collects, normalizes, and processes validator-related data from the **Consensus Layer** via standard Beacon node APIs and enriches it with **Execution Layer** data when needed.

## Packages

- **`packages/db`**: Prisma schema and migrations. See `packages/db/AGENTS.md` for data organization and storage.
- **`packages/beacon-utils`**: Shared beacon chain utilities (BeaconTime, chain config, validator status types).
- **`packages/indexer`**: Core indexing service. See `packages/indexer/AGENTS.md`.
- **`packages/api`**: REST/API layer. See `packages/api/AGENTS.md`.
- **`packages/webapp`**: Next.js frontend. See `packages/webapp/AGENTS.md`.
- **`packages/telegram-bot`**: Telegram bot for alerts.

## Tasks

### Issue Definition

**_Scope and Structure_**

- Each issue must have a single, clear, and well-defined goal.
- Issues must be standalone and self-contained.
- Descriptions should be self-explanatory and written as if implemented by an external contributor.
- Explicitly define boundaries (package, module, or layer).
- Issues should be designed to be implemented and reviewed independently.

**_Size and Complexity_**

- Work that is too large, spans multiple layers, or mixes concerns must be defined as an **epic**.
- Epics must be broken down into smaller, well-scoped sub-issues.

### Issue Implementation

**_Scope Adherence_**

- Implement **only** what is defined in the issue.
- Do not introduce changes outside the declared boundaries.

**_Pull Requests and Commits_**

- Pull requests must be atomic, self-contained, and independently mergeable.
- Commits should be small and have a single, clear intent.
- Before pushing a commit, ask for the user permission.

**_Quality and Knowledge Sharing_**

- Include relevant tests for the implemented scope.
- Update the relevant `AGENTS.md` files if new knowledge is discovered that may help future agents. We should update hight level definitions that help the agent understand how the system works, relay on relative paths and code is rule to learn the low level definitions.

## Global setup

- Install deps: `pnpm install`
- Run all tests: `pnpm test`
- Run e2e tests: `pnpm test:e2e:local`
- Lint: `pnpm lint`
- Type-check: `pnpm type-check` is defined in the root and also on each package.

**IMPORTANT**: Always use existing scripts from package.json. Don't run raw commands like `tsc --noEmit` directly.

## Database / Prisma commands

**IMPORTANT**: Always run Prisma commands from the **root** directory using these scripts. They handle DATABASE_URL configuration automatically via `scripts/setDbUrl.js`.

- `pnpm prisma:migrate` - Run migrations (creates new migration)
- `pnpm prisma:deploy` - Deploy migrations (apply existing migrations)
- `pnpm prisma:generate` - Generate Prisma client + build db package
- `pnpm prisma:studio` - Open Prisma Studio
- `pnpm prisma:push` - Push schema to DB (no migration file). If data loss warnings appear, run directly with flag:
  ```bash
  node scripts/setDbUrl.js pnpm --filter @beacon-indexer/db exec prisma db push --schema prisma/schema.prisma --accept-data-loss
  ```
- `pnpm prisma:reset` - Reset database

**Never** run `pnpm prisma migrate dev` directly from `packages/db` - it won't have DATABASE_URL set.

**Manual migrations**: If `prisma:migrate` has issues with drift, create migration files manually:

1. Create folder: `packages/db/prisma/migrations/<timestamp>_<name>/`
2. Create `migration.sql` with the SQL statements
3. E2E tests use `prisma migrate deploy` which applies these migrations

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
- Code comments are **always** in english.
