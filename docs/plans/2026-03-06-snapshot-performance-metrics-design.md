# Validators Snapshot - Performance Metrics

Epic: https://github.com/NodeSentinel/beacon-chain-validators-monitor/issues/54

## Overview

Extend the validators snapshot with performance metrics across multiple timeframes (1h, 1d, 1w, 1m). Track performance ratio, APY, and rewards (consensus, missed, execution) per timeframe. Enable Performance Table display on dashboard.

## 1. Schema (DB)

### Rename

- Table `validators_status_summary` -> `validators_snapshot_stats`
- Model references: `SummaryController/Storage` -> `SnapshotController/Storage`

### Model

```prisma
model ValidatorsSnapshotStats {
  validatorIndex                Int      @id @map("validator_index")

  // Estado
  status                        String   @map("status") @db.VarChar(10)
  isInactive                    Boolean  @default(false) @map("is_inactive")
  consecutiveMissedAttestations Int      @default(0) @map("consecutive_missed_attestations")

  // Balances
  balance          BigInt @map("balance")
  effectiveBalance BigInt @map("effective_balance")
  beaconStatus     Int?   @map("beacon_status")

  // Attestations (updated per slot)
  attestationsTotal  Int @map("attestations_total")
  attestationsMissed Int @map("attestations_missed")

  // Performance per timeframe (ratio 0.0000 - 1.0000)
  performance1h Decimal? @map("performance_1h") @db.Decimal(5, 4)
  performance1d Decimal? @map("performance_1d") @db.Decimal(5, 4)
  performance1w Decimal? @map("performance_1w") @db.Decimal(5, 4)
  performance1m Decimal? @map("performance_1m") @db.Decimal(5, 4)

  // APY per timeframe
  apy1h Decimal? @map("apy_1h") @db.Decimal(5, 2)
  apy1d Decimal? @map("apy_1d") @db.Decimal(5, 2)
  apy1w Decimal? @map("apy_1w") @db.Decimal(5, 2)
  apy1m Decimal? @map("apy_1m") @db.Decimal(5, 2)

  // Consensus rewards per timeframe
  consensusReward1h BigInt? @map("consensus_reward_1h")
  consensusReward1d BigInt? @map("consensus_reward_1d")
  consensusReward1w BigInt? @map("consensus_reward_1w")
  consensusReward1m BigInt? @map("consensus_reward_1m")

  // Missed rewards per timeframe
  missedReward1h BigInt? @map("missed_reward_1h")
  missedReward1d BigInt? @map("missed_reward_1d")
  missedReward1w BigInt? @map("missed_reward_1w")
  missedReward1m BigInt? @map("missed_reward_1m")

  // Execution rewards per timeframe
  executionReward1h Decimal? @map("execution_reward_1h") @db.Decimal(78, 0)
  executionReward1d Decimal? @map("execution_reward_1d") @db.Decimal(78, 0)
  executionReward1w Decimal? @map("execution_reward_1w") @db.Decimal(78, 0)
  executionReward1m Decimal? @map("execution_reward_1m") @db.Decimal(78, 0)

  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamp

  @@map("validators_snapshot_stats")
}
```

Removes the old `performance` field (Decimal 5,2) — replaced by the 4 per-timeframe fields.

## 2. Indexer - Snapshot XState Machine

A single new `snapshotMachine` replaces the current summary logic.

### Behavior

- Ticks every `slotDuration` (12s Ethereum, 5s Gnosis)
- On each tick, evaluates what needs updating based on in-memory counters
- On restart, all counters start at `null` -> first tick updates everything

### Update levels

| Level                     | Frequency                          | Data source                      | Columns updated                                                                                    |
| ------------------------- | ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| Attestations + inactivity | Every tick (if new slot processed) | Raw `committee`                  | `attestationsTotal`, `attestationsMissed`, `isInactive`, `consecutiveMissedAttestations`, `status` |
| Balances                  | Every epoch                        | `validator` table                | `balance`, `effectiveBalance`, `beaconStatus`                                                      |
| 1h                        | Every epoch completed              | Raw `committee` + `epochRewards` | `performance1h`, `apy1h`, `consensusReward1h`, `missedReward1h`, `executionReward1h`               |
| 1d                        | Every 30 min                       | `ValidatorHourlyArchive`         | `performance1d`, `apy1d`, `consensusReward1d`, `missedReward1d`, `executionReward1d`               |
| 1w                        | Every 3h                           | `ValidatorDailyArchive`          | `performance1w`, `apy1w`, `consensusReward1w`, `missedReward1w`, `executionReward1w`               |
| 1m                        | Every 6h                           | `ValidatorDailyArchive`          | `performance1m`, `apy1m`, `consensusReward1m`, `missedReward1m`, `executionReward1m`               |

### In-memory tracking

- `lastProcessedSlot: number | null` — for attestations
- `lastEpochUpdate: number | null` — last epoch processed for balances + 1h
- `last1dUpdate: number | null` — timestamp of last 1d update
- `last1wUpdate: number | null` — timestamp of last 1w update
- `last1mUpdate: number | null` — timestamp of last 1m update

### Machine structure

```
idle -> (wait slotDuration) -> tick -> (evaluate & update) -> idle
```

Runs independently with its own timer. The controller queries indexer state (last processed slot/epoch) to determine if there's new data.

## 3. Indexer - Controller & Storage

### Rename

`SummaryController` -> `SnapshotController`, `SummaryStorage` -> `SnapshotStorage`

### SnapshotController methods

- `updateAttestations(currentProcessedSlot)` — updates attestations, inactivity, consecutive missed. Uses `UPSERT` instead of `TRUNCATE + INSERT`.
- `updateBalances(currentEpoch)` — updates balance, effectiveBalance, beaconStatus once per epoch.
- `updatePerformance1h(currentEpoch)` — calculates from raw data (last hour)
- `updatePerformance1d()` — calculates from `ValidatorHourlyArchive` (last 24h)
- `updatePerformance1w()` — calculates from `ValidatorDailyArchive` (last 7 days)
- `updatePerformance1m()` — calculates from `ValidatorDailyArchive` (last 30 days)

### Key change

Current query does `TRUNCATE + INSERT`. Changed to `INSERT ... ON CONFLICT (validator_index) DO UPDATE` so attestation updates don't wipe performance columns.

### Calculations

```
performance = attestationsOnTime / totalAttestations  (ratio 0-1)
APY = (consensus_rewards_in_period / balance) * periods_per_year
```

`periods_per_year`: 1h -> 8766, 1d -> 365.25, 1w -> 52.18, 1m -> 12

## 4. API

### Rename endpoints

- `GET /clusters/:id/stats` -> `GET /clusters/:id/snapshot`
- `GET /clusters/all/stats` -> `GET /clusters/all/snapshot`

### Response shape

```ts
{
  // Counts by status
  activeCount: number,
  inactiveCount: number,
  statusBreakdown: { [beaconStatus: string]: number },

  // Balances (sum)
  totalBalance: bigint,
  totalEffectiveBalance: bigint,

  // Attestations (sum)
  attestationsTotal: number,
  attestationsMissed: number,

  // Performance per timeframe (weighted average)
  performance1h: number | null,
  performance1d: number | null,
  performance1w: number | null,
  performance1m: number | null,

  // APY per timeframe (weighted average by balance)
  apy1h: number | null,
  apy1d: number | null,
  apy1w: number | null,
  apy1m: number | null,

  // Rewards per timeframe (sum)
  consensusReward1h: bigint | null,
  consensusReward1d: bigint | null,
  consensusReward1w: bigint | null,
  consensusReward1m: bigint | null,

  missedReward1h: bigint | null,
  missedReward1d: bigint | null,
  missedReward1w: bigint | null,
  missedReward1m: bigint | null,

  executionReward1h: bigint | null,
  executionReward1d: bigint | null,
  executionReward1w: bigint | null,
  executionReward1m: bigint | null,
}
```

## 5. Webapp - Performance Table

Component inside the cluster dashboard overview:

| Period | APY% | Consensus | Missed Rewards | Execution | Total USD |
| ------ | ---- | --------- | -------------- | --------- | --------- |
| 1h     | X%   | X GWei    | X GWei         | X GWei    | -         |
| 1d     | X%   | X GWei    | X GWei         | X GWei    | -         |
| 1w     | X%   | X GWei    | X GWei         | X GWei    | -         |
| 1m     | X%   | X GWei    | X GWei         | X GWei    | -         |

- Consumes `GET /clusters/:id/snapshot` (cached with TanStack Query)
- `null` values shown as `-` (data not yet available)
- "Total USD" column present but shows `-` until price endpoint exists

## 6. E2E Tests - Inactivity Detection

Dedicated e2e test validating the activity/inactivity detection logic, covering critical slot timing edge cases.

### Key concept

A validator's attestation can only be evaluated after `slot + maxAttestationDelay` has been processed. Before that, the attestation might still arrive.

### Scenarios

1. **Active validator** - attests on-time (delay <= maxAttestationDelay) -> status `active`
2. **Inactive validator** - misses N consecutive attestations (N = `missedAttestationsForInactivity`) -> status `inactive`
3. **Slot not yet processed** - validator assigned to slot 5, indexer at slot 3 -> cannot evaluate, must NOT count as missed
4. **Within delay window** - validator assigned to slot 5, maxAttestationDelay=2, indexer at slot 6 -> could still arrive at slot 7, must NOT count as missed
5. **Past delay window** - validator assigned to slot 5, maxAttestationDelay=2, indexer at slot 8 -> window expired, if no attestation then it's missed
6. **Recovery** - inactive validator attests again -> status changes to `active`
7. **Null attestation delay** - counts as missed

### Pattern

Same as existing e2e tests: Docker PostgreSQL, beacon data fixtures, mocked `BeaconClient`.
