# Validators Snapshot - Performance Metrics

Epic: https://github.com/NodeSentinel/beacon-chain-validators-monitor/issues/54

## Overview

Extend the validators snapshot with performance metrics across multiple timeframes (h, d, w, m). Track performance ratio, APY, and rewards (consensus, missed, execution) per timeframe. Enable Performance Table display on dashboard.

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
  performanceH Decimal? @map("performance_h") @db.Decimal(5, 4)
  performanceD Decimal? @map("performance_d") @db.Decimal(5, 4)
  performanceW Decimal? @map("performance_w") @db.Decimal(5, 4)
  performanceM Decimal? @map("performance_m") @db.Decimal(5, 4)

  // APY per timeframe
  apyH Decimal? @map("apy_h") @db.Decimal(5, 2)
  apyD Decimal? @map("apy_d") @db.Decimal(5, 2)
  apyW Decimal? @map("apy_w") @db.Decimal(5, 2)
  apyM Decimal? @map("apy_m") @db.Decimal(5, 2)

  // Consensus rewards per timeframe
  consensusRewardH BigInt? @map("consensus_reward_h")
  consensusRewardD BigInt? @map("consensus_reward_d")
  consensusRewardW BigInt? @map("consensus_reward_w")
  consensusRewardM BigInt? @map("consensus_reward_m")

  // Missed rewards per timeframe
  missedRewardH BigInt? @map("missed_reward_h")
  missedRewardD BigInt? @map("missed_reward_d")
  missedRewardW BigInt? @map("missed_reward_w")
  missedRewardM BigInt? @map("missed_reward_m")

  // Execution rewards per timeframe
  executionRewardH Decimal? @map("execution_reward_h") @db.Decimal(78, 0)
  executionRewardD Decimal? @map("execution_reward_d") @db.Decimal(78, 0)
  executionRewardW Decimal? @map("execution_reward_w") @db.Decimal(78, 0)
  executionRewardM Decimal? @map("execution_reward_m") @db.Decimal(78, 0)

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
| h                         | Every epoch completed              | Raw `committee` + `epochRewards` | `performanceH`, `apyH`, `consensusRewardH`, `missedRewardH`, `executionRewardH`                    |
| d                         | Every 30 min                       | `ValidatorHourlyArchive`         | `performanceD`, `apyD`, `consensusRewardD`, `missedRewardD`, `executionRewardD`                    |
| w                         | Every 3h                           | `ValidatorDailyArchive`          | `performanceW`, `apyW`, `consensusRewardW`, `missedRewardW`, `executionRewardW`                    |
| m                         | Every 6h                           | `ValidatorDailyArchive`          | `performanceM`, `apyM`, `consensusRewardM`, `missedRewardM`, `executionRewardM`                    |

### In-memory tracking

- `lastProcessedSlot: number | null` — for attestations
- `lastEpochUpdate: number | null` — last epoch processed for balances + h
- `lastDUpdate: number | null` — timestamp of last d update
- `lastWUpdate: number | null` — timestamp of last w update
- `lastMUpdate: number | null` — timestamp of last m update

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
- `updatePerformanceH(currentEpoch)` — calculates from raw data (last hour)
- `updatePerformanceD()` — calculates from `ValidatorHourlyArchive` (last 24h)
- `updatePerformanceW()` — calculates from `ValidatorDailyArchive` (last 7 days)
- `updatePerformanceM()` — calculates from `ValidatorDailyArchive` (last 30 days)

### Key change

Current query does `TRUNCATE + INSERT`. Changed to `INSERT ... ON CONFLICT (validator_index) DO UPDATE` so attestation updates don't wipe performance columns.

### Calculations

```
performance = attestationsOnTime / totalAttestations  (ratio 0-1)
APY = (consensus_rewards_in_period / balance) * periods_per_year
```

`periods_per_year`: h -> 8766, d -> 365.25, w -> 52.18, m -> 12

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
  performanceH: number | null,
  performanceD: number | null,
  performanceW: number | null,
  performanceM: number | null,

  // APY per timeframe (weighted average by balance)
  apyH: number | null,
  apyD: number | null,
  apyW: number | null,
  apyM: number | null,

  // Rewards per timeframe (sum)
  consensusRewardH: bigint | null,
  consensusRewardD: bigint | null,
  consensusRewardW: bigint | null,
  consensusRewardM: bigint | null,

  missedRewardH: bigint | null,
  missedRewardD: bigint | null,
  missedRewardW: bigint | null,
  missedRewardM: bigint | null,

  executionRewardH: string | null,
  executionRewardD: string | null,
  executionRewardW: string | null,
  executionRewardM: string | null,
}
```

## 5. Webapp - Performance Table

Component inside the cluster dashboard overview:

| Period | APY% | Consensus | Missed Rewards | Execution | Total USD |
| ------ | ---- | --------- | -------------- | --------- | --------- |
| h      | X%   | X GWei    | X GWei         | X GWei    | -         |
| d      | X%   | X GWei    | X GWei         | X GWei    | -         |
| w      | X%   | X GWei    | X GWei         | X GWei    | -         |
| m      | X%   | X GWei    | X GWei         | X GWei    | -         |

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
