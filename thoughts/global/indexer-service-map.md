# Indexer Service Map

## Entry Point

`packages/indexer/src/index.ts` — Main initialization. Creates all storage, controllers, clients, and starts XState machines.

## Controllers

Location: `packages/indexer/src/services/consensus/controllers/`

| File               | Class                                                         | Dependencies                                                               | Purpose                                                         |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `epoch.ts`         | `EpochController` (extends `EpochControllerHelpers`)          | BeaconClient, EpochStorage, ValidatorsStorage, BeaconTime                  | Epoch rewards, committees, sync committees, proposer duties     |
| `slot.ts`          | `SlotController` (extends `SlotControllerHelpers`)            | SlotStorage, EpochStorage, BeaconClient, BeaconTime, ExecutionClient       | Slot processing: blocks, attestations, rewards                  |
| `validators.ts`    | `ValidatorsController` (extends `ValidatorControllerHelpers`) | BeaconClient, ValidatorsStorage, BeaconTime                                | Validator initialization and state tracking                     |
| `chainStats.ts`    | `ChainStatsController`                                        | ChainStatsStorage, BeaconTime                                              | Per-epoch chain-wide statistics (writes to `chain_epoch_stats`) |
| `summary.ts`       | `SummaryController`                                           | SummaryStorage, BeaconTime                                                 | Hourly validator status summaries                               |
| `hourlyArchive.ts` | `HourlyArchiveController`                                     | HourlyArchiveStorage, PartitionController, BeaconTime, maxAttestationDelay | Hourly data archiving                                           |
| `partition.ts`     | `PartitionController`                                         | PartitionStorage, BeaconTime                                               | Partition discovery and management                              |
| `indexerConfig.ts` | `IndexerConfigController`                                     | IndexerConfigStorage                                                       | Configuration validation                                        |

### Helper Files

Location: `packages/indexer/src/services/consensus/controllers/helpers/`

| File                            | Purpose                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `epochControllerHelpers.ts`     | Reward calculations, ideal reward lookup, missed reward processing            |
| `slotControllerHelpers.ts`      | Bitfield processing, attestation deduplication, sync/block reward preparation |
| `validatorControllerHelpers.ts` | Validator data mapping (API → DB entity)                                      |
| `partitionNaming.ts`            | Partition name generation and parsing                                         |

## Storage

Location: `packages/indexer/src/services/consensus/storage/`

| File               | Class                  | Constructor               | Key Methods                                                                                           |
| ------------------ | ---------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `epoch.ts`         | `EpochStorage`         | PrismaClient, databaseUrl | createEpochs, getMinEpochToProcess, processEpochRewardsAndAggregate (COPY), saveCommitteesData (COPY) |
| `slot.ts`          | `SlotStorage`          | PrismaClient              | saveSlotAttestations, saveValidatorWithdrawals, updateCommitteeAttestationDelays                      |
| `validators.ts`    | `ValidatorsStorage`    | PrismaClient, databaseUrl | saveValidators, saveValidatorBalances (COPY), getAttestingValidatorIndexes                            |
| `chainStats.ts`    | `ChainStatsStorage`    | PrismaClient              | insertChainEpochStats (raw SQL INSERT + ON CONFLICT DO NOTHING), getLastProcessedEpoch                |
| `summary.ts`       | `SummaryStorage`       | PrismaClient              | validatorsStatusSummary (TRUNCATE + INSERT raw SQL)                                                   |
| `hourlyArchive.ts` | `HourlyArchiveStorage` | PrismaClient              | archiveHourAtomically (complex CTE + transaction)                                                     |
| `partition.ts`     | `PartitionStorage`     | PrismaClient              | discoverPartitions, createPartition, dropPartition                                                    |
| `indexerConfig.ts` | `IndexerConfigStorage` | PrismaClient              | Configuration persistence                                                                             |

### Storage Patterns

- **Simple CRUD**: `prisma.model.findUnique()`, `.create()`, `.update()` — for flags, lookups
- **Raw SQL upsert**: `prisma.$executeRaw` with `ON CONFLICT DO UPDATE` — for aggregation + upsert
- **COPY FROM STDIN**: Native pg pool for bulk inserts (EpochStorage, ValidatorsStorage) — temp table → COPY → INSERT SELECT (minimal WAL)
- **Complex CTE**: Multi-stage SQL with CTEs for aggregation (hourlyArchive)
- **Transactions**: `prisma.$transaction()` for atomic multi-step operations

## External Clients

| Client            | Purpose             | Key Methods                                                     |
| ----------------- | ------------------- | --------------------------------------------------------------- |
| `BeaconClient`    | Consensus layer API | getAttestationRewards, getCommittees, getBlock, getValidators   |
| `ExecutionClient` | Execution layer RPC | getBlock (for execution rewards)                                |
| `BeaconTime`      | Time calculations   | getSlotNumberFromTimestamp, getEpochFromSlot, slot/epoch ranges |

## Initialization Order (src/index.ts)

1. PrismaClient + connect
2. BeaconClient, BeaconTime, ExecutionClient
3. Storage classes (receive PrismaClient)
4. Controllers (receive storage + clients)
5. `initXstateMachines()` (receives controllers, creates/starts actors + orchestrator)
