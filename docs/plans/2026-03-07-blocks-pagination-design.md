# Blocks Pagination Design

## Goal

Add a paginated blocks endpoint and update the Events > Blocks tab to show real block proposal data for a cluster or individual validator.

## Endpoint: `blocks`

### Input

- `clusterId?: string` — blocks proposed by all validators in the cluster
- `validatorIndex?: number` — blocks proposed by a single validator
- `page?: number` (default 1)
- `pageSize`: fixed at 10
- One of `clusterId` or `validatorIndex` is required (mutually exclusive)

### Output

```ts
{
  blocks: Array<{
    slot: number;
    blockNumber: number | null;
    validatorIndex: number;
    timestamp: number; // derived from slot via BeaconTime
    consensusReward: string | null; // bigint as string
    executionReward: string | null; // decimal as string (wei)
  }>;
  totalCount: number;
  page: number;
  pageSize: number;
}
```

## DB Migration

Add index to the `Slot` model for efficient lookups by proposer:

```prisma
@@index([proposerIndex, slot(sort: Desc)])
```

## Query Strategy

**By validator:**

```sql
SELECT slot, block_number, proposer_index, consensus_reward, execution_reward
FROM slot
WHERE proposer_index = ?
ORDER BY slot DESC
LIMIT 10 OFFSET ?
```

**By cluster:**

```sql
SELECT s.slot, s.block_number, s.proposer_index, s.consensus_reward, s.execution_reward
FROM slot s
JOIN cluster_validator cv ON s.proposer_index = cv.validator_index
WHERE cv.cluster_id = ?
ORDER BY s.slot DESC
LIMIT 10 OFFSET ?
```

Both queries leverage the new `(proposer_index, slot DESC)` index.

## Layers

1. **DB**: New migration adding the index
2. **API Storage**: New method for querying block proposals (new file or in existing storage)
3. **API Router**: New `blocks` procedure
4. **Webapp Hook**: New `useBlocks` hook
5. **Webapp UI**: Update `events-feed-content.tsx` — Blocks tab fetches real data with Prev/Next pagination

## Scope

- Only the Blocks tab gets real data and pagination
- Other Events tabs (Incidents, Consolidations, Deposits, Withdrawals) remain unchanged
