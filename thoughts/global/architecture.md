# Architecture Overview

## Monorepo Packages

| Package                 | Purpose                                                             | Key Entry              |
| ----------------------- | ------------------------------------------------------------------- | ---------------------- |
| `packages/db`           | Prisma schema, migrations                                           | `prisma/schema.prisma` |
| `packages/beacon-utils` | Shared utilities (BeaconTime, chain config, validator status types) | `src/index.ts`         |
| `packages/indexer`      | Core indexing service — fetches and processes beacon chain data     | `src/index.ts`         |
| `packages/api`          | REST API layer                                                      | `AGENTS.md`            |
| `packages/webapp`       | Next.js frontend                                                    | `AGENTS.md`            |
| `packages/telegram-bot` | Telegram alerts                                                     | —                      |

Each package has its own `AGENTS.md` with package-specific architecture details.

## Indexer Dependency Flow

```
XState (orchestration) → Controllers (business logic) → Storage (persistence) → Database
```

- **XState machines** manage state transitions, retries, delays, error recovery. No business logic.
- **Controllers** hold all business logic, fetch from APIs, transform/validate data, coordinate storage.
- **Storage** classes contain only Prisma queries and raw SQL. No business logic or data transformation.

## Initialization Chain

Main entry: `packages/indexer/src/index.ts`

```
PrismaClient → Storage classes → Controllers → initXstateMachines()
                                                  ├─ Create/start actor(s) for triggered jobs
                                                  ├─ Start epochCreationMachine
                                                  └─ Start epochOrchestratorMachine (receives actor refs)
```

External clients created in main: `BeaconClient`, `ExecutionClient`, `BeaconTime`.

## Key Architectural Patterns

### Epoch-Triggered Jobs

Jobs that run after each epoch use a standard pattern:

1. XState machine with 2 states: `idle` → `processing` → `idle`
2. Listens for `EPOCH_PROCESSED` event from epoch orchestrator
3. Delegates to a controller, which delegates to storage
4. Non-overlapping execution (ignores events while processing)
5. Actor reference passed to epoch orchestrator at initialization

**Reference implementation**: `packages/indexer/src/xstate/archive/hourlyArchive.machine.ts`
**See**: `thoughts/global/xstate-patterns.md` for details

### Two-Tier Storage

Raw tables (temporary, partitioned) → Archive tables (permanent, time-aggregated).
Moving boundary: data older than boundary in archives only, newer in raw only.
Archival cascade: Raw → Hourly → Daily → Weekly → Monthly.

**See**: `packages/db/AGENTS.md` and `thoughts/global/database-schema.md`

### Constructor Dependency Injection

All dependencies are injected via constructors. No service locators, no singletons (except static pg pools for COPY operations in EpochStorage and ValidatorsStorage).

## Supported Chains

Ethereum and Gnosis beacon chains. Chain-specific config loaded at startup. E2E tests use Gnosis chain data.
