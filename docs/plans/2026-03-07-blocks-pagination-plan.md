# Blocks Pagination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a paginated blocks endpoint that returns proposed blocks for a cluster or validator, and wire it into the Events > Blocks tab UI.

**Architecture:** New `blocks` procedure in the cluster router queries the `slot` table joined with `cluster_validator`. A new index on `(proposer_index, slot DESC)` enables efficient pagination. The webapp fetches blocks via a new hook and renders them with Prev/Next buttons.

**Tech Stack:** Prisma (raw SQL), oRPC, Zod, React Query, Next.js

---

### Task 1: Add DB index on Slot.proposerIndex

**Files:**

- Modify: `packages/db/prisma/schema.prisma:100` (add index before `@@map("slot")`)

**Step 1: Add the index**

In `packages/db/prisma/schema.prisma`, inside the `Slot` model, change:

```prisma
  @@index([slot, processed])
  @@map("slot")
```

to:

```prisma
  @@index([slot, processed])
  @@index([proposerIndex, slot(sort: Desc)])
  @@map("slot")
```

**Step 2: Generate migration**

Run:

```bash
cd packages/db && npx prisma migrate dev --name add_slot_proposer_index
```

Expected: Migration created and applied successfully.

**Step 3: Commit**

```bash
git add packages/db/prisma/
git commit -m "db: add index on slot(proposer_index, slot DESC)"
```

---

### Task 2: Add storage method for block proposals

**Files:**

- Modify: `packages/api/src/storage/cluster.ts` (add method at end of class)

**Step 1: Add the `getBlockProposals` method**

Add this method to the `ClusterStorage` class in `packages/api/src/storage/cluster.ts`:

```typescript
  /**
   * Get paginated block proposals for a cluster or single validator
   */
  async getBlockProposals(params: {
    clusterId?: string;
    validatorIndex?: number;
    page: number;
    pageSize: number;
  }) {
    const { page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    if (params.clusterId) {
      const [rows, countResult] = await Promise.all([
        this.prisma.$queryRaw<
          Array<{
            slot: number;
            block_number: number | null;
            proposer_index: number;
            consensus_reward: bigint | null;
            execution_reward: string | null;
          }>
        >`
          SELECT s.slot, s.block_number, s.proposer_index, s.consensus_reward, s.execution_reward::text
          FROM slot s
          JOIN cluster_validator cv ON s.proposer_index = cv.validator_index
          WHERE cv.cluster_id = ${params.clusterId}
            AND s.proposer_index IS NOT NULL
          ORDER BY s.slot DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `,
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*)::bigint AS count
          FROM slot s
          JOIN cluster_validator cv ON s.proposer_index = cv.validator_index
          WHERE cv.cluster_id = ${params.clusterId}
            AND s.proposer_index IS NOT NULL
        `,
      ]);

      return { rows, totalCount: Number(countResult[0].count) };
    }

    // Single validator
    const validatorIndex = params.validatorIndex!;
    const [rows, countResult] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          slot: number;
          block_number: number | null;
          proposer_index: number;
          consensus_reward: bigint | null;
          execution_reward: string | null;
        }>
      >`
        SELECT slot, block_number, proposer_index, consensus_reward, execution_reward::text
        FROM slot
        WHERE proposer_index = ${validatorIndex}
        ORDER BY slot DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM slot
        WHERE proposer_index = ${validatorIndex}
      `,
    ]);

    return { rows, totalCount: Number(countResult[0].count) };
  }
```

**Step 2: Commit**

```bash
git add packages/api/src/storage/cluster.ts
git commit -m "feat(api): add getBlockProposals storage method"
```

---

### Task 3: Add Zod schemas for blocks endpoint

**Files:**

- Modify: `packages/api/src/routers/cluster/schemas.ts` (add schemas at end of file)

**Step 1: Add input and output schemas**

Add at the end of `packages/api/src/routers/cluster/schemas.ts`:

```typescript
// Block proposals
export const BlockProposalsInputSchema = z
  .object({
    clusterId: z.string().optional(),
    validatorIndex: z.number().int().nonnegative().optional(),
    page: z.number().int().positive().default(1),
  })
  .refine((data) => data.clusterId !== undefined || data.validatorIndex !== undefined, {
    message: 'Either clusterId or validatorIndex must be provided',
  })
  .refine((data) => !(data.clusterId !== undefined && data.validatorIndex !== undefined), {
    message: 'Only one of clusterId or validatorIndex can be provided',
  });

export const BlockProposalSchema = z.object({
  slot: z.number(),
  blockNumber: z.number().nullable(),
  validatorIndex: z.number(),
  timestamp: z.number(),
  consensusReward: z.string().nullable(),
  executionReward: z.string().nullable(),
});

export const BlockProposalsOutputSchema = z.object({
  blocks: z.array(BlockProposalSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
```

**Step 2: Commit**

```bash
git add packages/api/src/routers/cluster/schemas.ts
git commit -m "feat(api): add block proposals schemas"
```

---

### Task 4: Add blocks procedure in the API router

**Files:**

- Create: `packages/api/src/routers/cluster/blocks.ts`
- Modify: `packages/api/src/routers/cluster/index.ts` (add blocks to router)

**Step 1: Create the blocks procedure**

Create `packages/api/src/routers/cluster/blocks.ts`:

```typescript
import { BlockProposalsInputSchema, BlockProposalsOutputSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance, formatWeiToToken } from '@/utils/tokenFormat.js';
import { beaconTime } from '@/utils/beaconTime.js';

const PAGE_SIZE = 10;

/**
 * Get paginated block proposals for a cluster or validator
 * GET /blocks
 */
export const getBlockProposals = publicProcedure
  .route({ method: 'GET', path: '/blocks' })
  .input(BlockProposalsInputSchema)
  .output(ApiResponseSchema(BlockProposalsOutputSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();
      const { rows, totalCount } = await storage.getBlockProposals({
        clusterId: input.clusterId,
        validatorIndex: input.validatorIndex,
        page: input.page,
        pageSize: PAGE_SIZE,
      });

      const blocks = rows.map((row) => ({
        slot: row.slot,
        blockNumber: row.block_number,
        validatorIndex: row.proposer_index,
        timestamp: beaconTime.getTimestampFromSlotNumber(row.slot),
        consensusReward: row.consensus_reward !== null ? formatBalance(row.consensus_reward) : null,
        executionReward:
          row.execution_reward !== null ? formatWeiToToken(row.execution_reward) : null,
      }));

      return {
        success: true,
        data: {
          blocks,
          totalCount,
          page: input.page,
          pageSize: PAGE_SIZE,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch block proposals';
      return {
        success: false,
        error: { code: 'BLOCK_PROPOSALS_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
```

**Step 2: Register in cluster router**

In `packages/api/src/routers/cluster/index.ts`, add the import and export:

Add import:

```typescript
import { getBlockProposals } from './blocks.js';
```

Add to the router object:

```typescript
blocks: getBlockProposals,
```

**Step 3: Verify types compile**

Run:

```bash
cd packages/api && pnpm type-check
```

Expected: No type errors.

**Step 4: Commit**

```bash
git add packages/api/src/routers/cluster/blocks.ts packages/api/src/routers/cluster/index.ts
git commit -m "feat(api): add paginated block proposals endpoint"
```

---

### Task 5: Add useBlockProposals hook in webapp

**Files:**

- Create: `packages/webapp/hooks/use-block-proposals.ts`

**Step 1: Create the hook**

Create `packages/webapp/hooks/use-block-proposals.ts`:

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface BlockProposal {
  slot: number;
  blockNumber: number | null;
  validatorIndex: number;
  timestamp: number;
  consensusReward: string | null;
  executionReward: string | null;
}

export interface BlockProposalsResult {
  blocks: BlockProposal[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export function useBlockProposals(
  params: { clusterId?: string; validatorIndex?: number } | null,
  page: number = 1,
) {
  const hasFilter = params && (params.clusterId || params.validatorIndex !== undefined);

  return useQuery({
    queryKey: ['blockProposals', params?.clusterId, params?.validatorIndex, page],
    queryFn: async () => {
      if (!params) throw new Error('No filter provided');

      const response = await orpcClient.cluster.blocks({
        clusterId: params.clusterId,
        validatorIndex: params.validatorIndex,
        page,
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch block proposals');
      }

      return response.data as BlockProposalsResult;
    },
    enabled: !!hasFilter,
  });
}
```

**Step 2: Commit**

```bash
git add packages/webapp/hooks/use-block-proposals.ts
git commit -m "feat(webapp): add useBlockProposals hook"
```

---

### Task 6: Update EventsFeedContent to use real blocks data

**Files:**

- Modify: `packages/webapp/components/validators/events-feed-content.tsx`
- Modify: `packages/webapp/app/page.tsx`

**Step 1: Update EventsFeedContent props and Blocks tab**

Rewrite `packages/webapp/components/validators/events-feed-content.tsx`. The key changes:

- Add `clusterId` prop
- Import and use `useBlockProposals` hook for the Blocks tab
- Add pagination state and Prev/Next buttons
- Keep other tabs unchanged (they still use the `events` prop)

```typescript
'use client';

import { useState } from 'react';

import ArrowRight from '@/components/icons/arrow-right';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  UnderlineTabs,
  UnderlineTabsContent,
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from '@/components/underline-tabs';
import { useBlockProposals } from '@/hooks/use-block-proposals';
import { cn, formatTime } from '@/lib/utils';
import type { ValidatorEvent, Validator } from '@/types/validator';

interface EventsFeedContentProps {
  clusterId: string | null;
  events: ValidatorEvent[];
  validators: Validator[];
  gnoPrice: number;
}

export default function EventsFeedContent({
  clusterId,
  events,
  validators: _validators,
  gnoPrice,
}: EventsFeedContentProps) {
  const [blocksPage, setBlocksPage] = useState(1);

  const { data: blocksData, isLoading: blocksLoading } = useBlockProposals(
    clusterId ? { clusterId } : null,
    blocksPage,
  );

  const incidentEvents = events.filter((e) => e.type === 'inactive' || e.type === 'slashed');

  const groupedIncidents = incidentEvents.reduce(
    (acc, event) => {
      const key = `${event.timestamp}-${event.type}`;
      if (!acc[key]) {
        acc[key] = {
          timestamp: event.timestamp,
          type: event.type,
          validators: [],
          details: event.details,
        };
      }
      acc[key].validators.push(event.validatorIndex);
      return acc;
    },
    {} as Record<
      string,
      { timestamp: string; type: string; validators: number[]; details: string }
    >,
  );

  const incidents = Object.values(groupedIncidents);

  const consolidations = events.filter((e) => e.type === 'consolidation');
  const deposits = events.filter((e) => e.type === 'deposit');
  const withdrawals = events.filter(
    (e) => e.type === 'partial_withdrawal' || e.type === 'full_withdrawal',
  );

  const totalBlockPages = blocksData ? Math.ceil(blocksData.totalCount / blocksData.pageSize) : 0;

  return (
    <div className="relative border border-border/50 rounded-lg p-3 md:p-4 pt-5 md:pt-6">
      <span className="absolute -top-2.5 left-3 bg-transparent px-1.5 text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider">
        Events
      </span>
      <UnderlineTabs defaultValue="blocks">
        <UnderlineTabsList>
          <UnderlineTabsTrigger value="blocks">Blocks</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="incidents">Incidents</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="consolidations">Consolidations</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="deposits">Deposits</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="withdrawals">Withdrawals</UnderlineTabsTrigger>
        </UnderlineTabsList>

        <UnderlineTabsContent value="blocks" className="space-y-2 mt-4 min-h-[400px]">
          {blocksLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 bg-foreground/5 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : blocksData && blocksData.blocks.length > 0 ? (
            <div className="space-y-2">
              {blocksData.blocks.map((block) => (
                <BlockItem key={block.slot} block={block} />
              ))}
              {totalBlockPages > 1 && (
                <div className="flex items-center justify-between pt-3 border-t border-border/50">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBlocksPage((p) => Math.max(1, p - 1))}
                    disabled={blocksPage <= 1}
                  >
                    Prev
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {blocksPage} of {totalBlockPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBlocksPage((p) => Math.min(totalBlockPages, p + 1))}
                    disabled={blocksPage >= totalBlockPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No blocks proposed</p>
          )}
        </UnderlineTabsContent>

        {/* incidents, consolidations, deposits, withdrawals tabs remain unchanged */}
        <UnderlineTabsContent value="incidents" className="space-y-2 mt-4 min-h-[400px]">
          {incidents.length > 0 ? (
            <div className="space-y-2">
              {incidents.map((incident, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 md:gap-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30"
                >
                  <div className="text-xl md:text-2xl font-display flex-shrink-0 text-destructive">
                    {incident.type === 'slashed' ? '✕' : '⚠'}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="destructive" className="text-xs">
                        {incident.type === 'slashed' ? 'Slashed' : 'Inactive'}
                      </Badge>
                      <span className="text-xs font-mono text-muted-foreground">
                        {incident.validators.length} validator
                        {incident.validators.length !== 1 ? 's' : ''} affected
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Date: </span>
                        <span className="font-medium">{formatTime(incident.timestamp)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Duration: </span>
                        <span className="font-medium">2h 15m</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cost: </span>
                        <span className="font-mono font-medium text-destructive">
                          {(0.05 * incident.validators.length).toFixed(2)} GNO
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">USD: </span>
                        <span className="font-mono font-medium">
                          ${(0.05 * incident.validators.length * gnoPrice).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No incidents</p>
          )}
        </UnderlineTabsContent>

        <UnderlineTabsContent value="consolidations" className="space-y-2 mt-4 min-h-[400px]">
          {consolidations.length > 0 ? (
            consolidations.map((event) => (
              <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No consolidations</p>
          )}
        </UnderlineTabsContent>

        <UnderlineTabsContent value="deposits" className="space-y-2 mt-4 min-h-[400px]">
          {deposits.length > 0 ? (
            deposits.map((event) => <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No deposits</p>
          )}
        </UnderlineTabsContent>

        <UnderlineTabsContent value="withdrawals" className="space-y-2 mt-4 min-h-[400px]">
          {withdrawals.length > 0 ? (
            withdrawals.map((event) => (
              <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No withdrawals</p>
          )}
        </UnderlineTabsContent>
      </UnderlineTabs>
    </div>
  );
}

// --- BlockItem component for real block proposal data ---

interface BlockItemProps {
  block: {
    slot: number;
    blockNumber: number | null;
    validatorIndex: number;
    timestamp: number;
    consensusReward: string | null;
    executionReward: string | null;
  };
}

function BlockItem({ block }: BlockItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 md:gap-3 p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <div className="text-xl md:text-2xl font-display flex-shrink-0 text-chart-1">■</div>

          <div className="flex-1 text-left min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="default" className="text-xs">
                Block Proposed
              </Badge>
              <span className="text-xs font-mono text-muted-foreground">
                Val #{block.validatorIndex}
              </span>
            </div>
            <p className="text-sm line-clamp-1">
              Slot {block.slot.toLocaleString()}
              {block.blockNumber !== null && ` · Block #${block.blockNumber.toLocaleString()}`}
            </p>
          </div>

          <div className="flex flex-col md:flex-row items-end md:items-center gap-1 md:gap-3 flex-shrink-0">
            {block.consensusReward && (
              <span className="text-xs md:text-sm font-display text-success whitespace-nowrap">
                {block.consensusReward} GNO
              </span>
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap hidden md:inline">
              {formatTime(new Date(block.timestamp).toISOString())}
            </span>
            <ArrowRight
              className={cn(
                'size-5 text-foreground/60 transition-transform flex-shrink-0',
                isOpen && 'rotate-90',
                'group-hover:text-foreground',
              )}
            />
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 py-3 ml-6 md:ml-11 space-y-2 text-sm border-l-2 border-border">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Validator Index</span>
            <span className="font-mono text-xs md:text-sm">{block.validatorIndex}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Slot</span>
            <span className="font-mono text-xs md:text-sm">{block.slot.toLocaleString()}</span>
          </div>
          {block.blockNumber !== null && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Block Number</span>
              <span className="font-mono text-xs md:text-sm">
                {block.blockNumber.toLocaleString()}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Timestamp</span>
            <span className="font-mono text-xs break-all">
              {new Date(block.timestamp).toISOString()}
            </span>
          </div>
          {block.consensusReward && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Consensus Reward</span>
              <span className="font-display text-success text-xs md:text-sm">
                {block.consensusReward} GNO
              </span>
            </div>
          )}
          {block.executionReward && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Execution Reward</span>
              <span className="font-display text-success text-xs md:text-sm">
                {block.executionReward}
              </span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// --- EventItem component (unchanged, used by other tabs) ---

interface EventItemProps {
  event: ValidatorEvent;
  gnoPrice: number;
}

function EventItem({ event, gnoPrice: _gnoPrice }: EventItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  const getEventIcon = (type: ValidatorEvent['type']) => {
    switch (type) {
      case 'deposit':
        return '↓';
      case 'partial_withdrawal':
        return '↑';
      case 'full_withdrawal':
        return '⇈';
      case 'inactive':
        return '⚠';
      case 'block_proposed':
        return '■';
      case 'sync_committee':
        return '⚡';
      case 'slashed':
        return '✕';
      case 'attestation':
        return '✓';
      case 'consolidation':
        return '⇄';
    }
  };

  const getEventVariant = (type: ValidatorEvent['type']) => {
    switch (type) {
      case 'deposit':
        return 'default';
      case 'partial_withdrawal':
      case 'full_withdrawal':
        return 'default';
      case 'inactive':
      case 'slashed':
        return 'destructive';
      case 'block_proposed':
      case 'sync_committee':
      case 'attestation':
      case 'consolidation':
        return 'default';
    }
  };

  const getEventColor = (type: ValidatorEvent['type']) => {
    switch (type) {
      case 'deposit':
        return 'text-chart-2';
      case 'partial_withdrawal':
      case 'full_withdrawal':
        return 'text-success';
      case 'inactive':
      case 'slashed':
        return 'text-destructive';
      case 'block_proposed':
        return 'text-chart-1';
      case 'sync_committee':
        return 'text-warning';
      case 'attestation':
        return 'text-positive';
      case 'consolidation':
        return 'text-chart-3';
    }
  };

  const formatEventType = (type: ValidatorEvent['type']) => {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 md:gap-3 p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <div
            className={cn(
              'text-xl md:text-2xl font-display flex-shrink-0',
              getEventColor(event.type),
            )}
          >
            {getEventIcon(event.type)}
          </div>

          <div className="flex-1 text-left min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={getEventVariant(event.type)} className="text-xs">
                {formatEventType(event.type)}
              </Badge>
              <span className="text-xs font-mono text-muted-foreground">
                Val #{event.validatorIndex}
              </span>
            </div>
            <p className="text-sm line-clamp-2 md:line-clamp-1">{event.details}</p>
          </div>

          <div className="flex flex-col md:flex-row items-end md:items-center gap-1 md:gap-3 flex-shrink-0">
            {event.amount && (
              <span className="text-xs md:text-sm font-display text-success whitespace-nowrap">
                {event.amount} GNO
              </span>
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap hidden md:inline">
              {formatTime(event.timestamp)}
            </span>
            <ArrowRight
              className={cn(
                'size-5 text-foreground/60 transition-transform flex-shrink-0',
                isOpen && 'rotate-90',
                'group-hover:text-foreground',
              )}
            />
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 py-3 ml-6 md:ml-11 space-y-2 text-sm border-l-2 border-border">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Validator Index</span>
            <span className="font-mono text-xs md:text-sm">{event.validatorIndex}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Timestamp</span>
            <span className="font-mono text-xs break-all">
              {new Date(event.timestamp).toISOString()}
            </span>
          </div>
          {event.amount && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Amount</span>
              <span className="font-display text-success text-xs md:text-sm">
                {event.amount} GNO
              </span>
            </div>
          )}
          {event.blockNumber && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Block Number</span>
              <span className="font-mono text-xs md:text-sm">
                {event.blockNumber.toLocaleString()}
              </span>
            </div>
          )}
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">{event.details}</p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

**Step 2: Update page.tsx to pass clusterId**

In `packages/webapp/app/page.tsx`, change line 147:

From:

```typescript
<EventsFeedContent events={emptyEvents} validators={[]} gnoPrice={tokenPrice} />
```

To:

```typescript
<EventsFeedContent clusterId={selectedClusterId} events={emptyEvents} validators={[]} gnoPrice={tokenPrice} />
```

**Step 3: Verify types compile**

Run:

```bash
cd packages/webapp && pnpm type-check
```

Expected: No type errors.

**Step 4: Commit**

```bash
git add packages/webapp/
git commit -m "feat(webapp): wire blocks tab to real paginated API data"
```

---

### Task 7: Manual verification

**Step 1: Start the API and webapp**

Run the dev servers and verify:

1. Select a cluster in the dashboard
2. Navigate to the Events > Blocks tab
3. Verify block proposals load from the API
4. Test Prev/Next pagination
5. Verify "No blocks proposed" shows for clusters with no proposals
6. Verify loading skeleton shows while fetching

**Step 2: Test without cluster selected**

Verify the Blocks tab shows "No blocks proposed" when no cluster is selected (since `clusterId` will be `null` and the query is disabled).
