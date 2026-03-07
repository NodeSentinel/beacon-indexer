# Missed Attestations Analytics — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add API endpoints and frontend hook to display missed attestation data in the Analytics chart, querying from `committee` (1h) or `validator_hourly_archive` (24h).

**Architecture:** New storage class `AnalyticsStorage` with two raw SQL methods (one per time range). Three oRPC routes sharing a single handler function. Frontend hook `useMissedAttestations` calls the appropriate route and passes data to existing `AnalyticsContent` component.

**Tech Stack:** oRPC, Prisma raw SQL, Zod, React Query, BeaconTime

---

### Task 1: Create AnalyticsStorage class

**Files:**

- Create: `packages/api/src/storage/analytics.ts`

**Step 1: Create the storage class with both query methods**

```typescript
import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

interface MissedAttestationRow {
  epoch: number;
  count: bigint;
  validator_count: bigint;
}

interface MissedAttestationArchiveRow {
  timestamp: Date;
  count: bigint;
  validator_count: bigint;
}

export class AnalyticsStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Query missed attestations from committee table (raw data, recent ~1h)
   * Groups by epoch, returns count of missed attestations and distinct validators affected.
   */
  async getMissedAttestationsFromCommittee(
    validatorIndexes: number[],
    fromSlot: number,
    maxAttestationDelay: number,
  ): Promise<MissedAttestationRow[]> {
    if (validatorIndexes.length === 0) return [];

    return this.prisma.$queryRawUnsafe<MissedAttestationRow[]>(
      `SELECT
        (c.slot / $3) AS epoch,
        COUNT(*)::bigint AS count,
        COUNT(DISTINCT c.validator_index)::bigint AS validator_count
      FROM committee c
      WHERE c.validator_index = ANY($1::int[])
        AND c.slot >= $2
        AND (c.attestation_delay IS NULL OR c.attestation_delay > $4)
      GROUP BY (c.slot / $3)
      ORDER BY epoch ASC`,
      validatorIndexes,
      fromSlot,
      // slotsPerEpoch passed as $3
      // maxAttestationDelay passed as $4
    );
  }

  /**
   * Query missed attestations from validator_hourly_archive (last 24h)
   * Groups by hour timestamp, returns count and distinct validators.
   */
  async getMissedAttestationsFromArchive(
    validatorIndexes: number[],
    fromTimestamp: Date,
  ): Promise<MissedAttestationArchiveRow[]> {
    if (validatorIndexes.length === 0) return [];

    return this.prisma.$queryRaw<MissedAttestationArchiveRow[]>`
      SELECT
        vha.timestamp,
        COALESCE(SUM(vha.missed_attestation_count), 0)::bigint AS count,
        COUNT(DISTINCT vha.validator_index)::bigint AS validator_count
      FROM validator_hourly_archive vha
      WHERE vha.validator_index = ANY(${validatorIndexes}::int[])
        AND vha.timestamp >= ${fromTimestamp}
        AND vha.missed_attestation_count > 0
      GROUP BY vha.timestamp
      ORDER BY vha.timestamp ASC
    `;
  }
}
```

Wait — the `getMissedAttestationsFromCommittee` method needs `slotsPerEpoch` for the epoch grouping. Let me revise to pass it as a parameter and use proper `$queryRawUnsafe` for all dynamic values.

Revised version:

```typescript
import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

interface MissedAttestationRow {
  epoch: number;
  count: bigint;
  validator_count: bigint;
}

interface MissedAttestationArchiveRow {
  timestamp: Date;
  count: bigint;
  validator_count: bigint;
}

export class AnalyticsStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async getMissedAttestationsFromCommittee(
    validatorIndexes: number[],
    fromSlot: number,
    slotsPerEpoch: number,
    maxAttestationDelay: number,
  ): Promise<MissedAttestationRow[]> {
    if (validatorIndexes.length === 0) return [];

    return this.prisma.$queryRaw<MissedAttestationRow[]>`
      SELECT
        (c.slot / ${slotsPerEpoch}::int) AS epoch,
        COUNT(*)::bigint AS count,
        COUNT(DISTINCT c.validator_index)::bigint AS validator_count
      FROM committee c
      WHERE c.validator_index = ANY(${validatorIndexes}::int[])
        AND c.slot >= ${fromSlot}
        AND (c.attestation_delay IS NULL OR c.attestation_delay > ${maxAttestationDelay}::int)
      GROUP BY (c.slot / ${slotsPerEpoch}::int)
      ORDER BY epoch ASC
    `;
  }

  async getMissedAttestationsFromArchive(
    validatorIndexes: number[],
    fromTimestamp: Date,
  ): Promise<MissedAttestationArchiveRow[]> {
    if (validatorIndexes.length === 0) return [];

    return this.prisma.$queryRaw<MissedAttestationArchiveRow[]>`
      SELECT
        vha.timestamp,
        COALESCE(SUM(vha.missed_attestation_count), 0)::bigint AS count,
        COUNT(DISTINCT vha.validator_index)::bigint AS validator_count
      FROM validator_hourly_archive vha
      WHERE vha.validator_index = ANY(${validatorIndexes}::int[])
        AND vha.timestamp >= ${fromTimestamp}
        AND vha.missed_attestation_count > 0
      GROUP BY vha.timestamp
      ORDER BY vha.timestamp ASC
    `;
  }
}
```

**Step 2: Commit**

```bash
git add packages/api/src/storage/analytics.ts
git commit -m "feat(api): add AnalyticsStorage for missed attestation queries"
```

---

### Task 2: Create analytics schemas

**Files:**

- Create: `packages/api/src/routers/cluster/analytics-schemas.ts`

**Step 1: Create Zod schemas for input and output**

```typescript
import { z } from 'zod';

export const MissedAttestationsInputSchema = z.object({
  id: z.string(),
  range: z.enum(['1h', '24h']).default('1h'),
});

export const MissedAttestationsValidatorInputSchema = z.object({
  index: z.coerce.number().int().nonnegative(),
  range: z.enum(['1h', '24h']).default('1h'),
});

export const MissedAttestationItemSchema = z.object({
  timestamp: z.string(),
  count: z.number(),
  validatorCount: z.number(),
});

export const MissedAttestationsResponseSchema = z.array(MissedAttestationItemSchema);
```

**Step 2: Commit**

```bash
git add packages/api/src/routers/cluster/analytics-schemas.ts
git commit -m "feat(api): add missed attestations Zod schemas"
```

---

### Task 3: Create the missed attestations route handler

**Files:**

- Create: `packages/api/src/routers/cluster/missed-attestations.ts`

This file contains the shared handler logic and three route definitions.

**Step 1: Create the route file**

```typescript
import {
  MissedAttestationsInputSchema,
  MissedAttestationsResponseSchema,
  MissedAttestationsValidatorInputSchema,
} from './analytics-schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { AnalyticsStorage } from '@/storage/analytics.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { beaconTime, chainConfig } from '@/utils/beaconTime.js';
import { ApiResponseSchema } from '@/utils/response.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

async function getValidatorIndexesForCluster(clusterId: string): Promise<number[]> {
  const clusterStorage = new ClusterStorage();
  const cluster = await clusterStorage.findByIdWithValidators(clusterId);
  if (!cluster) return [];
  return cluster.validators.map((v) => v.validatorIndex);
}

async function getAllValidatorIndexesForOwner(ownerId: string): Promise<number[]> {
  const clusterStorage = new ClusterStorage();
  const clusters = await clusterStorage.listByOwner(BigInt(ownerId));
  if (clusters.length === 0) return [];

  // Get all validators from all clusters
  const allValidators = new Set<number>();
  for (const cluster of clusters) {
    const detail = await clusterStorage.findByIdWithValidators(cluster.id);
    if (detail) {
      for (const v of detail.validators) {
        allValidators.add(v.validatorIndex);
      }
    }
  }
  return Array.from(allValidators);
}

interface MissedAttestationResult {
  timestamp: string;
  count: number;
  validatorCount: number;
}

async function fetchMissedAttestations(
  validatorIndexes: number[],
  range: '1h' | '24h',
): Promise<MissedAttestationResult[]> {
  const analytics = new AnalyticsStorage();
  const now = Date.now();

  if (range === '1h') {
    const fromSlot = beaconTime.getSlotNumberFromTimestamp(now - ONE_HOUR_MS);
    const rows = await analytics.getMissedAttestationsFromCommittee(
      validatorIndexes,
      fromSlot,
      chainConfig.beacon.slotsPerEpoch,
      chainConfig.beacon.maxAttestationDelay,
    );
    return rows.map((row) => ({
      timestamp: new Date(beaconTime.getTimestampFromEpochNumber(Number(row.epoch))).toISOString(),
      count: Number(row.count),
      validatorCount: Number(row.validator_count),
    }));
  }

  // 24h — use archive
  const fromTimestamp = new Date(now - TWENTY_FOUR_HOURS_MS);
  const rows = await analytics.getMissedAttestationsFromArchive(validatorIndexes, fromTimestamp);
  return rows.map((row) => ({
    timestamp: row.timestamp.toISOString(),
    count: Number(row.count),
    validatorCount: Number(row.validator_count),
  }));
}

/**
 * GET /clusters/{id}/analytics/missed-attestations?range=1h|24h
 */
export const getClusterMissedAttestations = publicProcedure
  .route({ method: 'GET', path: '/clusters/{id}/analytics/missed-attestations' })
  .input(MissedAttestationsInputSchema)
  .output(ApiResponseSchema(MissedAttestationsResponseSchema))
  .handler(async ({ input }) => {
    const validatorIndexes = await getValidatorIndexesForCluster(input.id);
    const data = await fetchMissedAttestations(validatorIndexes, input.range);
    return {
      success: true,
      data,
      meta: { timestamp: new Date().toISOString() },
    };
  });

/**
 * GET /clusters/all/analytics/missed-attestations?range=1h|24h
 * Requires ownerId query param to identify user
 */
export const getAllClustersMissedAttestations = publicProcedure
  .route({ method: 'GET', path: '/clusters/all/analytics/missed-attestations' })
  .input(z.object({ ownerId: z.string(), range: z.enum(['1h', '24h']).default('1h') }))
  .output(ApiResponseSchema(MissedAttestationsResponseSchema))
  .handler(async ({ input }) => {
    const validatorIndexes = await getAllValidatorIndexesForOwner(input.ownerId);
    const data = await fetchMissedAttestations(validatorIndexes, input.range);
    return {
      success: true,
      data,
      meta: { timestamp: new Date().toISOString() },
    };
  });

/**
 * GET /validators/{index}/analytics/missed-attestations?range=1h|24h
 */
export const getValidatorMissedAttestations = publicProcedure
  .route({ method: 'GET', path: '/validators/{index}/analytics/missed-attestations' })
  .input(MissedAttestationsValidatorInputSchema)
  .output(ApiResponseSchema(MissedAttestationsResponseSchema))
  .handler(async ({ input }) => {
    const data = await fetchMissedAttestations([input.index], input.range);
    return {
      success: true,
      data,
      meta: { timestamp: new Date().toISOString() },
    };
  });
```

Note: Add `import { z } from 'zod';` at the top for the `allClusters` route inline schema.

**Step 2: Commit**

```bash
git add packages/api/src/routers/cluster/missed-attestations.ts
git commit -m "feat(api): add missed attestations route handlers"
```

---

### Task 4: Register the routes

**Files:**

- Modify: `packages/api/src/routers/cluster/index.ts`
- Modify: `packages/api/src/routers/validator/index.ts`

**Step 1: Add cluster analytics routes to cluster router**

In `packages/api/src/routers/cluster/index.ts`, add:

```typescript
import {
  getClusterMissedAttestations,
  getAllClustersMissedAttestations,
} from './missed-attestations.js';
```

And add to the exported router object:

```typescript
missedAttestations: getClusterMissedAttestations,
allMissedAttestations: getAllClustersMissedAttestations,
```

**Step 2: Add validator analytics route to validator router**

In `packages/api/src/routers/validator/index.ts`, add:

```typescript
import { getValidatorMissedAttestations } from '../cluster/missed-attestations.js';
```

And add to the exported router object:

```typescript
missedAttestations: getValidatorMissedAttestations,
```

**Step 3: Verify type-check passes**

Run: `cd packages/api && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/api/src/routers/cluster/index.ts packages/api/src/routers/validator/index.ts
git commit -m "feat(api): register missed attestations routes in cluster and validator routers"
```

---

### Task 5: Create frontend hook

**Files:**

- Create: `packages/webapp/hooks/use-missed-attestations.ts`

**Step 1: Create the hook**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';
import type { MissedAttestation } from '@/types/validator';

type TimeRange = '1h' | '24h';

export function useMissedAttestations(
  clusterId: string | null,
  validatorIndex: number | null,
  range: TimeRange = '1h',
) {
  const isCluster = clusterId !== null && validatorIndex === null;
  const isAllClusters = clusterId === 'all';
  const isValidator = validatorIndex !== null;

  return useQuery({
    queryKey: ['missedAttestations', clusterId, validatorIndex, range],
    queryFn: async (): Promise<MissedAttestation[]> => {
      let response;

      if (isValidator) {
        response = await orpcClient.validator.missedAttestations({
          index: validatorIndex,
          range,
        });
      } else if (isAllClusters) {
        // TODO: pass ownerId when auth is implemented
        response = await orpcClient.cluster.allMissedAttestations({
          ownerId: '0',
          range,
        });
      } else if (isCluster) {
        response = await orpcClient.cluster.missedAttestations({
          id: clusterId,
          range,
        });
      } else {
        return [];
      }

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch missed attestations');
      }

      return (response.data ?? []).map((item) => ({
        timestamp: item.timestamp,
        count: item.count,
        validatorCount: item.validatorCount,
      }));
    },
    enabled: isCluster || isValidator,
    refetchInterval: 30_000,
  });
}
```

**Step 2: Commit**

```bash
git add packages/webapp/hooks/use-missed-attestations.ts
git commit -m "feat(webapp): add useMissedAttestations hook"
```

---

### Task 6: Wire up the hook in page.tsx

**Files:**

- Modify: `packages/webapp/app/page.tsx`

**Step 1: Import the hook and replace empty data**

Add import:

```typescript
import { useMissedAttestations } from '@/hooks/use-missed-attestations';
```

Remove:

```typescript
const emptyMissedAttestations: MissedAttestation[] = [];
```

Inside `DashboardOverview`, after the existing hooks, add:

```typescript
const { data: missedAttestations } = useMissedAttestations(selectedClusterId, null, '1h');
```

Replace the `AnalyticsContent` usage:

```diff
- <AnalyticsContent data={emptyMissedAttestations} />
+ <AnalyticsContent data={missedAttestations ?? []} />
```

**Step 2: Enable the 24h select option in analytics-content.tsx**

In `packages/webapp/components/validators/analytics-content.tsx`, remove `disabled` from the 24h SelectItem:

```diff
- <SelectItem value="24h" disabled>
+ <SelectItem value="24h">
```

But wait — the `AnalyticsContent` component currently manages `timeRange` state internally and filters data client-side. To support 24h we need the hook to refetch with the new range. This means we either:

- Lift `timeRange` state up to `page.tsx` and pass it to both the hook and the component
- Or have the component accept an `onTimeRangeChange` callback

The simpler approach: lift `timeRange` to page.tsx.

In `page.tsx`, add state:

```typescript
const [analyticsTimeRange, setAnalyticsTimeRange] = useState<'1h' | '24h'>('1h');
```

Update the hook call:

```typescript
const { data: missedAttestations } = useMissedAttestations(
  selectedClusterId,
  null,
  analyticsTimeRange,
);
```

Pass timeRange and setter to AnalyticsContent:

```diff
- <AnalyticsContent data={missedAttestations ?? []} />
+ <AnalyticsContent
+   data={missedAttestations ?? []}
+   timeRange={analyticsTimeRange}
+   onTimeRangeChange={setAnalyticsTimeRange}
+ />
```

In `analytics-content.tsx`, update the props interface:

```typescript
interface AnalyticsContentProps {
  data: MissedAttestation[];
  timeRange: '1h' | '24h';
  onTimeRangeChange: (range: '1h' | '24h') => void;
}
```

Remove internal `timeRange` state and use props instead. Remove `disabled` from 24h option. Update `Select` to use `onTimeRangeChange`.

**Step 3: Verify type-check passes**

Run: `cd packages/webapp && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/webapp/app/page.tsx packages/webapp/components/validators/analytics-content.tsx packages/webapp/hooks/use-missed-attestations.ts
git commit -m "feat(webapp): wire missed attestations data to analytics chart"
```

---

### Task 7: Verify end-to-end

**Step 1: Start API and webapp**

```bash
pnpm dev:api &
pnpm dev:webapp &
```

**Step 2: Test API endpoint directly**

```bash
curl "http://localhost:3001/clusters/<test-cluster-id>/analytics/missed-attestations?range=1h"
```

Expected: JSON response with `{ success: true, data: [...] }`

**Step 3: Verify in browser**

Open the dashboard, select a cluster, and check that the Analytics > Missed Attestations chart shows real data instead of "No data available".

**Step 4: Test 24h range**

Switch to "Last 24h" in the dropdown and verify data loads from the archive table.
