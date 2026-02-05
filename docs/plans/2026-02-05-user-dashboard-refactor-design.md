# User Dashboard Refactor - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the User Dashboard to use cluster tabs with sticky behavior, unifying all sections under a single cohesive card.

**Architecture:** Replace independent cards with a single container card. Cluster selection via horizontal tabs (sticky on scroll). Internal sections flow without their own cards, separated by subtle dividers.

**Tech Stack:** React, Radix UI Tabs, Tailwind CSS, existing UI components

---

## Design Summary

Refactor del diseño de la sección "User Dashboard" para mejorar la jerarquía visual y cohesión entre el selector de cluster y las secciones que dependen de él.

## Problema actual

- Cada sección tiene su propia card independiente
- No hay jerarquía visual clara entre el selector de cluster y las secciones subordinadas
- Falta cohesión visual - parece que las secciones no están relacionadas

## Solución

### Estructura general

Card único que contiene todo el dashboard del usuario:

```
┌─────────────────────────────────────────────────────────┐
│  [All] [Cluster A] [Cluster B] [Cluster C]  [+]         │ ← Tabs sticky
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Validators: 12    Balance: 384 GNO                     │
│  Performance: 99.5%  Claimable: 2.4 GNO                 │
│                                                         │
│  ───────────────────────────────────────────────────    │
│                                                         │
│  PERFORMANCE METRICS              [tipo ▼] [rango ▼]    │
│  [Gráfico de barras]                                    │
│                                                         │
│  ───────────────────────────────────────────────────    │
│                                                         │
│  EVENTS                                                 │
│  [Incidents] [Blocks] [Deposits] [Withdrawals]          │
│  [Lista de eventos]                                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Tabs de clusters

**Comportamiento:**

- Tabs horizontales en el header del card
- "All" como primer tab (vista agregada de todos los clusters)
- Tab "+" al final para crear nuevo cluster (abre sheet)
- Mobile: scroll horizontal con fade sutil en los bordes

**Sticky behavior:**

- Los tabs se adhieren al top del viewport al scrollear
- Aparece sombra sutil (`shadow-md`) cuando está en modo sticky
- Fondo sólido (mismo color que el card) para legibilidad

**Estilos:**

- Tab activo: estilo pill/rounded con fondo destacado
- Tabs inactivos: solo texto, sin fondo
- Tab "+": ícono Plus, mismo tamaño que los demás

### Secciones internas

Las secciones fluyen dentro del card sin cards propios, separadas por líneas sutiles.

**1. Cluster Overview**

- Sin título (el contexto viene del tab seleccionado)
- Contenido: validators count + status badges, balances (total, effective, claimable), performance (1h, 24h, 7d, 30d)
- Tabla de APY/rewards por período
- Botón "Manage Cluster" solo visible cuando NO es "All"

**2. Performance Metrics**

- Título pequeño "PERFORMANCE METRICS" en `text-muted-foreground`
- Selectores de tipo y rango temporal alineados a la derecha
- Gráfico de barras debajo

**3. Events Feed**

- Título pequeño "EVENTS"
- Tabs internos: Incidents, Consolidations, Blocks, Deposits, Withdrawals
- Lista de eventos según tab seleccionado

**Separadores:**

- Línea `border-border/50`
- Padding vertical generoso (`py-6` o similar)

### Responsive (Mobile)

- Tabs de clusters: scroll horizontal (swipeable)
- Fade visual en los bordes para indicar más contenido
- Sticky tabs funcionan igual
- Contenido interno se adapta con grid responsive existente

## Archivos a modificar

1. `packages/webapp/app/page.tsx` - Reestructurar layout principal
2. `packages/webapp/components/validators/cluster-controls.tsx` - Convertir a tabs
3. `packages/webapp/components/validators/cluster-list.tsx` - Integrar en nuevo layout
4. `packages/webapp/components/validators/cluster-overview.tsx` - Remover card wrapper
5. `packages/webapp/components/validators/performance-metrics.tsx` - Remover card wrapper
6. `packages/webapp/components/validators/events-feed.tsx` - Remover card wrapper

## Nuevo componente

- `packages/webapp/components/validators/user-dashboard.tsx` - Componente contenedor principal con:
  - Tabs de clusters (sticky)
  - Lógica de selección de cluster
  - Renderizado de secciones internas

## Consideraciones técnicas

- Usar `sticky top-0` con detección de scroll para agregar sombra
- Implementar scroll horizontal en tabs con CSS (`overflow-x-auto`)
- Mantener la lógica existente de agregación para "All Clusters"
- Sheet de crear cluster se mantiene igual

---

## Implementation Tasks

### Task 1: Create UserDashboard container component

**Files:**

- Create: `packages/webapp/components/validators/user-dashboard.tsx`

**Step 1: Create the base component with cluster tabs**

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { CLUSTER_FILTER_ALL, type Cluster, type ClusterFilter } from '@/types/cluster';

interface UserDashboardProps {
  clusters: Cluster[];
  isLoading?: boolean;
  onAddCluster: () => void;
  children: (props: {
    selectedCluster: ClusterFilter;
    displayCluster: Cluster | null;
    isAllSelected: boolean;
  }) => React.ReactNode;
}

function getAggregatedCluster(clusters: Cluster[]): Cluster {
  const allValidators = clusters.flatMap((cluster) => cluster.validators);
  const totalBalance = clusters.reduce((sum, cluster) => sum + cluster.totalBalance, 0);
  const totalEffectiveBalance = clusters.reduce(
    (sum, cluster) => sum + cluster.totalEffectiveBalance,
    0,
  );
  const totalClaimable = clusters.reduce((sum, cluster) => sum + cluster.claimableRewards, 0);
  const avgPerformance =
    clusters.length > 0
      ? clusters.reduce((sum, cluster) => sum + cluster.performance, 0) / clusters.length
      : 0;

  return {
    id: 'all',
    name: 'All Clusters',
    visibility: 'private',
    ownerId: '',
    withdrawalAddresses: [],
    feeRecipientAddress: null,
    validatorIndices: [],
    validators: allValidators,
    validatorCount: allValidators.length,
    totalBalance,
    totalEffectiveBalance,
    claimableRewards: totalClaimable,
    performance: avgPerformance,
  };
}

export default function UserDashboard({
  clusters,
  isLoading,
  onAddCluster,
  children,
}: UserDashboardProps) {
  const [selectedCluster, setSelectedCluster] = useState<ClusterFilter>(CLUSTER_FILTER_ALL);
  const [isSticky, setIsSticky] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Intersection Observer for sticky detection
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSticky(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: '-1px 0px 0px 0px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const isAllSelected = selectedCluster === CLUSTER_FILTER_ALL;
  const displayCluster = isAllSelected
    ? getAggregatedCluster(clusters)
    : clusters.find((c) => c.id === selectedCluster) || null;

  if (isLoading) {
    return <UserDashboardSkeleton />;
  }

  return (
    <Card>
      {/* Sentinel element for intersection observer */}
      <div ref={sentinelRef} className="h-0" />

      <Tabs
        value={selectedCluster}
        onValueChange={(value) => setSelectedCluster(value as ClusterFilter)}
        className="flex flex-col"
      >
        <div
          ref={tabsRef}
          className={cn(
            'sticky top-0 z-10 bg-pop rounded-t-lg transition-shadow duration-200',
            isSticky && 'shadow-md',
          )}
        >
          <div className="overflow-x-auto scrollbar-none">
            <TabsList className="w-auto min-w-full justify-start bg-transparent p-2 gap-1">
              <TabsTrigger value={CLUSTER_FILTER_ALL} className="shrink-0">
                All
              </TabsTrigger>
              {clusters.map((cluster) => (
                <TabsTrigger key={cluster.id} value={cluster.id} className="shrink-0">
                  {cluster.name}
                </TabsTrigger>
              ))}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  onAddCluster();
                }}
                className="shrink-0 inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                <Plus className="size-4" />
              </button>
            </TabsList>
          </div>
        </div>

        <CardContent className="p-0">
          <TabsContent value={selectedCluster} className="m-0">
            {children({ selectedCluster, displayCluster, isAllSelected })}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}

function UserDashboardSkeleton() {
  return (
    <Card>
      <div className="p-2">
        <div className="flex gap-2">
          <div className="h-9 w-16 bg-foreground/5 rounded-md animate-pulse" />
          <div className="h-9 w-24 bg-foreground/5 rounded-md animate-pulse" />
          <div className="h-9 w-24 bg-foreground/5 rounded-md animate-pulse" />
        </div>
      </div>
      <CardContent>
        <div className="space-y-4">
          <div className="h-32 bg-foreground/5 rounded animate-pulse" />
          <div className="h-64 bg-foreground/5 rounded animate-pulse" />
          <div className="h-48 bg-foreground/5 rounded animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}
```

**Step 2: Verify the file compiles**

Run: `cd packages/webapp && npx tsc --noEmit`
Expected: No errors related to user-dashboard.tsx

**Step 3: Commit**

```bash
git add packages/webapp/components/validators/user-dashboard.tsx
git commit -m "feat(webapp): create UserDashboard container with sticky cluster tabs"
```

---

### Task 2: Create ClusterOverviewContent component (without card wrapper)

**Files:**

- Create: `packages/webapp/components/validators/cluster-overview-content.tsx`

**Step 1: Extract content from ClusterOverview without the DashboardCard wrapper**

```tsx
'use client';

import { Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Cluster } from '@/types/cluster';
import type { Stats } from '@/types/validator';

interface ClusterOverviewContentProps {
  cluster: Cluster;
  stats: Stats;
  gnoPrice: number;
  onManage: () => void;
  showManageButton?: boolean;
}

export default function ClusterOverviewContent({
  cluster,
  stats,
  gnoPrice,
  onManage,
  showManageButton = true,
}: ClusterOverviewContentProps) {
  const statusCounts = cluster.validators.reduce(
    (acc, v) => {
      acc[v.status] = (acc[v.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const getStatusDisplay = () => {
    const displays: { emoji: string; count: number; label: string; color: string }[] = [];

    if (statusCounts.active)
      displays.push({
        emoji: '🟢',
        count: statusCounts.active,
        label: 'active',
        color: 'text-success',
      });
    if (statusCounts.inactive)
      displays.push({
        emoji: '🟡',
        count: statusCounts.inactive,
        label: 'inactive',
        color: 'text-warning',
      });
    if (statusCounts.active_exiting)
      displays.push({
        emoji: '🟠',
        count: statusCounts.active_exiting,
        label: 'active exiting',
        color: 'text-orange-500',
      });
    if (statusCounts.slashed)
      displays.push({
        emoji: '🚫',
        count: statusCounts.slashed,
        label: 'slashed',
        color: 'text-destructive',
      });
    if (statusCounts.exited)
      displays.push({
        emoji: '🔚',
        count: statusCounts.exited,
        label: 'exited',
        color: 'text-muted-foreground',
      });

    return displays;
  };

  const totalValidators = cluster.validatorCount || cluster.validators.length;

  const balanceUsd = (cluster.totalBalance * gnoPrice).toFixed(2);
  const effectiveBalanceUsd = (cluster.totalEffectiveBalance * gnoPrice).toFixed(0);
  const claimableUsd = (cluster.claimableRewards * gnoPrice).toFixed(2);

  const performance24h = 82.0;
  const performance7d = 91.0;
  const performance30d = 98.0;

  return (
    <div className="p-4 md:p-6">
      {/* Header with manage button */}
      {showManageButton && (
        <div className="flex justify-end mb-4">
          <Button
            variant="outline"
            size="sm"
            className="bg-transparent shrink-0"
            onClick={onManage}
          >
            <Settings className="size-4 mr-2" />
            <span className="hidden sm:inline">Manage Cluster</span>
          </Button>
        </div>
      )}

      <div className="space-y-4 md:space-y-6">
        {/* Validators status */}
        <div className="flex items-center gap-3 md:gap-4 flex-wrap pb-2.5 md:pb-3 border-b border-border/50">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 font-semibold text-xs md:text-sm">
            {totalValidators} VALIDATOR{totalValidators !== 1 ? 'S' : ''}
          </span>
          {getStatusDisplay().map((status, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className="text-sm">{status.emoji}</span>
              <span className={`text-sm font-semibold ${status.color}`}>{status.count}</span>
              <span className="text-xs text-muted-foreground capitalize">{status.label}</span>
            </div>
          ))}
        </div>

        {/* Balances */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-4 pb-3.5 md:pb-4 border-b border-border/50">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">BALANCE</p>
            <span className="text-base md:text-xl font-display">
              {cluster.totalBalance.toFixed(2)} GNO
            </span>
            <p className="text-xs text-muted-foreground">${balanceUsd}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">EFFECTIVE BALANCE</p>
            <span className="text-base md:text-xl font-display">
              {cluster.totalEffectiveBalance.toFixed(0)} GNO
            </span>
            <p className="text-xs text-muted-foreground">${effectiveBalanceUsd}</p>
          </div>
          <div className="col-span-2 md:col-span-1">
            <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">CLAIMABLE</p>
            <span className="text-base md:text-xl font-display text-white">
              {cluster.claimableRewards.toFixed(2)} GNO
            </span>
            <p className="text-xs text-muted-foreground">${claimableUsd}</p>
          </div>
        </div>

        {/* Performance */}
        <div className="pb-3.5 md:pb-4 border-b border-border/50">
          <p className="text-[10px] md:text-xs text-muted-foreground mb-2.5 md:mb-3">PERFORMANCE</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">1H</p>
              <span className="text-xl md:text-2xl font-display text-white">
                {cluster.performance.toFixed(2)}%
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">24H</p>
              <span className="text-xl md:text-2xl font-display text-white">
                {performance24h.toFixed(2)}%
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">7D</p>
              <span className="text-xl md:text-2xl font-display text-white">
                {performance7d.toFixed(2)}%
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">30D</p>
              <span className="text-xl md:text-2xl font-display text-white">
                {performance30d.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* APY Table */}
        <div className="relative -mx-4 px-4 md:mx-0 md:px-0">
          <div
            className="overflow-x-auto overscroll-contain"
            style={{ overscrollBehaviorX: 'contain', overscrollBehaviorY: 'auto' }}
          >
            <div className="min-w-[600px] md:min-w-0">
              <div className="grid grid-cols-6 gap-4 text-center pb-2.5 md:pb-3 border-b border-border/50">
                <div className="text-xs text-muted-foreground">PERIOD</div>
                <div className="text-xs text-muted-foreground">APY%</div>
                <div className="text-xs text-muted-foreground">CONSENSUS</div>
                <div className="text-xs text-muted-foreground">MISSED REWARDS</div>
                <div className="text-xs text-muted-foreground">EXECUTION</div>
                <div className="text-xs text-muted-foreground">TOTAL USD</div>
              </div>

              {/* Daily */}
              <div className="grid grid-cols-6 gap-4 text-center py-2.5 md:py-3 border-b border-border/30">
                <div className="text-sm font-medium">Day</div>
                <div className="text-sm font-display text-white">{stats.apyDay.toFixed(2)}%</div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.gnoDay.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${(stats.gnoDay * gnoPrice).toFixed(2)}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold text-destructive">
                    {stats.missedDay.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">-</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.xdaiDay.toFixed(2)} xDAI
                  </div>
                  <div className="text-xs text-muted-foreground">${stats.xdaiDay.toFixed(2)}</div>
                </div>
                <div className="text-sm font-mono">${stats.totalDay.toFixed(2)}</div>
              </div>

              {/* Weekly */}
              <div className="grid grid-cols-6 gap-4 text-center py-2.5 md:py-3 border-b border-border/30">
                <div className="text-sm font-medium">Week</div>
                <div className="text-sm font-display text-white">{stats.apyWeek.toFixed(2)}%</div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.gnoWeek.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${(stats.gnoWeek * gnoPrice).toFixed(2)}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold text-destructive">
                    {stats.missedWeek.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">-</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.xdaiWeek.toFixed(2)} xDAI
                  </div>
                  <div className="text-xs text-muted-foreground">${stats.xdaiWeek.toFixed(2)}</div>
                </div>
                <div className="text-sm font-mono">${stats.totalWeek.toFixed(2)}</div>
              </div>

              {/* Monthly */}
              <div className="grid grid-cols-6 gap-4 text-center py-2.5 md:py-3">
                <div className="text-sm font-medium">Month</div>
                <div className="text-sm font-display text-white">{stats.apyMonth.toFixed(2)}%</div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.gnoMonth.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${(stats.gnoMonth * gnoPrice).toFixed(2)}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold text-destructive">
                    {stats.missedMonth.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">-</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.xdaiMonth.toFixed(2)} xDAI
                  </div>
                  <div className="text-xs text-muted-foreground">${stats.xdaiMonth.toFixed(2)}</div>
                </div>
                <div className="text-sm font-mono">${stats.totalMonth.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify the file compiles**

Run: `cd packages/webapp && npx tsc --noEmit`
Expected: No errors related to cluster-overview-content.tsx

**Step 3: Commit**

```bash
git add packages/webapp/components/validators/cluster-overview-content.tsx
git commit -m "feat(webapp): create ClusterOverviewContent without card wrapper"
```

---

### Task 3: Create PerformanceMetricsContent component (without card wrapper)

**Files:**

- Create: `packages/webapp/components/validators/performance-metrics-content.tsx`

**Step 1: Extract content from PerformanceMetrics without the DashboardCard wrapper**

```tsx
'use client';

import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';

import { ChartContainer } from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MissedAttestation } from '@/types/validator';

interface PerformanceMetricsContentProps {
  data: MissedAttestation[];
}

type TimeRange = '1h' | '24h' | '7d';
type MetricType = 'consensus-rewards' | 'execution-rewards' | 'missed-attestations';

export default function PerformanceMetricsContent({ data }: PerformanceMetricsContentProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [metricType, setMetricType] = useState<MetricType>('missed-attestations');

  const chartData = useMemo(() => {
    const now = new Date();
    let filteredData = [...data];

    if (timeRange === '1h') {
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      filteredData = data.filter((item) => new Date(item.timestamp) >= oneHourAgo);
    } else if (timeRange === '24h') {
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      filteredData = data.filter((item) => new Date(item.timestamp) >= oneDayAgo);
    }

    if (filteredData.length === 0) {
      return [];
    }

    return filteredData.map((item, i) => {
      const date = new Date(item.timestamp);
      let timeLabel = '';

      if (timeRange === '1h') {
        timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (timeRange === '24h') {
        timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else {
        timeLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }

      const seed = (i + 1) * 0.1;
      const executionReward = Number((0.3 + seed * 0.5).toFixed(3));
      const source = Number((0.25 + seed * 0.05).toFixed(3));
      const target = Number((0.26 + seed * 0.04).toFixed(3));
      const head = Number((0.24 + seed * 0.06).toFixed(3));
      const syncCommittee = i % 5 === 0 ? Number((0.15 + seed * 0.05).toFixed(3)) : 0;
      const missed = Number((seed * 0.15).toFixed(3));
      const consensusTotal = 1.0;

      return {
        time: timeLabel,
        missedValue: item.count * item.validatorCount,
        slot: item.count,
        validators: item.validatorCount,
        execution: executionReward,
        source,
        target,
        head,
        syncCommittee,
        missed,
        consensusTotal,
      };
    });
  }, [data, timeRange]);

  const stats = useMemo(() => {
    if (metricType === 'missed-attestations') {
      const totalMissed = chartData.reduce((sum, item) => sum + item.slot, 0);
      const maxValidators =
        chartData.length > 0 ? Math.max(...chartData.map((item) => item.validators)) : 0;
      return { totalMissed, maxValidators };
    } else if (metricType === 'execution-rewards') {
      const totalEarned = chartData.reduce((sum, item) => sum + item.execution, 0);
      return { totalEarned: totalEarned.toFixed(2) };
    } else {
      const totalSource = chartData.reduce((sum, item) => sum + item.source, 0).toFixed(2);
      const totalTarget = chartData.reduce((sum, item) => sum + item.target, 0).toFixed(2);
      const totalHead = chartData.reduce((sum, item) => sum + item.head, 0).toFixed(2);
      const totalSyncCommittee = chartData
        .reduce((sum, item) => sum + item.syncCommittee, 0)
        .toFixed(2);
      const totalMissed = chartData.reduce((sum, item) => sum + item.missed, 0).toFixed(2);
      return { totalSource, totalTarget, totalHead, totalSyncCommittee, totalMissed };
    }
  }, [chartData, metricType]);

  return (
    <div className="p-4 md:p-6 border-t border-border/50">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
        <h3 className="text-xs text-muted-foreground uppercase tracking-wide">
          Performance Metrics
        </h3>
        <div className="flex items-center gap-2">
          <Select value={metricType} onValueChange={(value) => setMetricType(value as MetricType)}>
            <SelectTrigger className="w-36 md:w-44 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="consensus-rewards">Consensus Rewards</SelectItem>
              <SelectItem value="execution-rewards">Execution Rewards</SelectItem>
              <SelectItem value="missed-attestations">Missed Attestations</SelectItem>
            </SelectContent>
          </Select>

          <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
            <SelectTrigger className="w-16 md:w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">1h</SelectItem>
              <SelectItem value="24h" disabled>
                24h
              </SelectItem>
              <SelectItem value="7d" disabled>
                7d
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[300px] text-muted-foreground">
          No data available
        </div>
      ) : (
        <div className="space-y-4">
          {metricType === 'missed-attestations' ? (
            <div className="grid grid-cols-2 gap-3 md:gap-4 pb-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">TOTAL MISSED</p>
                <span className="text-xl md:text-2xl font-display text-destructive">
                  {stats.totalMissed}
                </span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">VALIDATORS AFFECTED</p>
                <span className="text-xl md:text-2xl font-display text-warning">
                  {stats.maxValidators}
                </span>
              </div>
            </div>
          ) : metricType === 'execution-rewards' ? (
            <div className="grid grid-cols-1 gap-3 md:gap-4 pb-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">TOTAL EARNED</p>
                <span className="text-xl md:text-2xl font-display text-success">
                  {stats.totalEarned} GNO
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 pb-4">
              <div>
                <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">SOURCE</p>
                <span className="text-base md:text-lg font-display text-[#3b82f6]">
                  {stats.totalSource} GNO
                </span>
              </div>
              <div>
                <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">TARGET</p>
                <span className="text-base md:text-lg font-display text-[#10b981]">
                  {stats.totalTarget} GNO
                </span>
              </div>
              <div>
                <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">HEAD</p>
                <span className="text-base md:text-lg font-display text-[#8b5cf6]">
                  {stats.totalHead} GNO
                </span>
              </div>
              <div>
                <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">SYNC</p>
                <span className="text-base md:text-lg font-display text-[#fbbf24]">
                  {stats.totalSyncCommittee} GNO
                </span>
              </div>
              <div>
                <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">MISSED</p>
                <span className="text-base md:text-lg font-display text-destructive">
                  {stats.totalMissed} GNO
                </span>
              </div>
            </div>
          )}

          {metricType === 'missed-attestations' ? (
            <ChartContainer
              config={{
                missedValue: {
                  label: 'Missed',
                  color: '#fbbf24',
                },
              }}
              className="h-[250px] md:h-[300px] w-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    dataKey="time"
                    stroke="#888888"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#888888' }}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#888888' }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background p-3 shadow-md">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-xs text-muted-foreground">Slots:</span>
                              <span className="text-sm font-display">{data.slot}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-xs text-muted-foreground">Validators:</span>
                              <span className="text-sm font-display">{data.validators}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="missedValue" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : metricType === 'execution-rewards' ? (
            <ChartContainer
              config={{
                execution: {
                  label: 'Execution',
                  color: '#10b981',
                },
              }}
              className="h-[250px] md:h-[300px] w-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    dataKey="time"
                    stroke="#888888"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#888888' }}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#888888' }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background p-3 shadow-md">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-xs text-muted-foreground">Earned:</span>
                              <span className="text-sm font-display text-success">
                                {data.execution} GNO
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="execution" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <ChartContainer
              config={{
                source: { label: 'Source', color: '#3b82f6' },
                target: { label: 'Target', color: '#10b981' },
                head: { label: 'Head', color: '#8b5cf6' },
                syncCommittee: { label: 'Sync Committee', color: '#fbbf24' },
                missed: { label: 'Missed', color: '#ef4444' },
              }}
              className="h-[250px] md:h-[300px] w-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    dataKey="time"
                    stroke="#888888"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#888888' }}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#888888' }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background p-3 shadow-md">
                          <div className="space-y-1 text-xs">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-muted-foreground">Source:</span>
                              <span className="font-display" style={{ color: '#3b82f6' }}>
                                {data.source} GNO
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-muted-foreground">Target:</span>
                              <span className="font-display" style={{ color: '#10b981' }}>
                                {data.target} GNO
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-muted-foreground">Head:</span>
                              <span className="font-display" style={{ color: '#8b5cf6' }}>
                                {data.head} GNO
                              </span>
                            </div>
                            {data.syncCommittee > 0 && (
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Sync Committee:</span>
                                <span className="font-display text-warning">
                                  {data.syncCommittee} GNO
                                </span>
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-muted-foreground">Missed:</span>
                              <span className="font-display text-destructive">
                                {data.missed} GNO
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4 pt-1 border-t">
                              <span className="text-muted-foreground">Total:</span>
                              <span className="font-display">{data.consensusTotal} GNO</span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="source" stackId="consensus" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="target" stackId="consensus" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="head" stackId="consensus" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                  <Bar
                    dataKey="syncCommittee"
                    stackId="consensus"
                    fill="#fbbf24"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar dataKey="missed" stackId="consensus" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify the file compiles**

Run: `cd packages/webapp && npx tsc --noEmit`
Expected: No errors related to performance-metrics-content.tsx

**Step 3: Commit**

```bash
git add packages/webapp/components/validators/performance-metrics-content.tsx
git commit -m "feat(webapp): create PerformanceMetricsContent without card wrapper"
```

---

### Task 4: Create EventsFeedContent component (without card wrapper)

**Files:**

- Create: `packages/webapp/components/validators/events-feed-content.tsx`

**Step 1: Extract content from EventsFeed without the DashboardCard wrapper**

```tsx
'use client';

import { useState } from 'react';

import ArrowRight from '@/components/icons/arrow-right';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn, formatTime } from '@/lib/utils';
import type { ValidatorEvent, Validator } from '@/types/validator';

interface EventsFeedContentProps {
  events: ValidatorEvent[];
  validators: Validator[];
  gnoPrice: number;
}

export default function EventsFeedContent({
  events,
  validators: _validators,
  gnoPrice,
}: EventsFeedContentProps) {
  const [validatorFilter, setValidatorFilter] = useState<string>('');

  const filterEventsByValidator = (eventList: ValidatorEvent[]) => {
    if (!validatorFilter.trim()) return eventList;

    const filterIndices = validatorFilter
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '');

    if (filterIndices.length === 0) return eventList;

    return eventList.filter((e) =>
      filterIndices.some((index) => e.validatorIndex.toString() === index),
    );
  };

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

  const consolidations = filterEventsByValidator(events.filter((e) => e.type === 'consolidation'));
  const blocks = filterEventsByValidator(events.filter((e) => e.type === 'block_proposed'));
  const deposits = filterEventsByValidator(events.filter((e) => e.type === 'deposit'));
  const withdrawals = filterEventsByValidator(
    events.filter((e) => e.type === 'partial_withdrawal' || e.type === 'full_withdrawal'),
  );

  return (
    <div className="p-4 md:p-6 border-t border-border/50">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
        <h3 className="text-xs text-muted-foreground uppercase tracking-wide">Events</h3>
        <Input
          placeholder="Filter validators (e.g., 123, 456)"
          value={validatorFilter}
          onChange={(e) => setValidatorFilter(e.target.value)}
          className="w-48 md:w-64 h-8 text-xs md:text-sm"
          disabled
        />
      </div>

      <Tabs defaultValue="incidents" className="w-full">
        <div className="overflow-x-auto -mx-1 px-1 scrollbar-thin">
          <TabsList className="inline-flex w-auto min-w-full md:grid md:w-full md:grid-cols-5 h-auto">
            <TabsTrigger value="incidents" className="h-10 flex-shrink-0 px-3 md:px-3">
              Incidents
            </TabsTrigger>
            <TabsTrigger value="consolidations" className="h-10 flex-shrink-0 px-3 md:px-3">
              Consolidations
            </TabsTrigger>
            <TabsTrigger value="blocks" className="h-10 flex-shrink-0 px-3 md:px-3">
              Blocks
            </TabsTrigger>
            <TabsTrigger value="deposits" className="h-10 flex-shrink-0 px-3 md:px-3">
              Deposits
            </TabsTrigger>
            <TabsTrigger value="withdrawals" className="h-10 flex-shrink-0 px-3 md:px-3">
              Withdrawals
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="incidents" className="space-y-2 mt-4 min-h-[400px]">
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
        </TabsContent>

        <TabsContent value="consolidations" className="space-y-2 mt-4 min-h-[400px]">
          {consolidations.length > 0 ? (
            consolidations.map((event) => (
              <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No consolidations</p>
          )}
        </TabsContent>

        <TabsContent value="blocks" className="space-y-2 mt-4 min-h-[400px]">
          {blocks.length > 0 ? (
            blocks.map((event) => <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No blocks proposed</p>
          )}
        </TabsContent>

        <TabsContent value="deposits" className="space-y-2 mt-4 min-h-[400px]">
          {deposits.length > 0 ? (
            deposits.map((event) => <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No deposits</p>
          )}
        </TabsContent>

        <TabsContent value="withdrawals" className="space-y-2 mt-4 min-h-[400px]">
          {withdrawals.length > 0 ? (
            withdrawals.map((event) => (
              <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No withdrawals</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

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

**Step 2: Verify the file compiles**

Run: `cd packages/webapp && npx tsc --noEmit`
Expected: No errors related to events-feed-content.tsx

**Step 3: Commit**

```bash
git add packages/webapp/components/validators/events-feed-content.tsx
git commit -m "feat(webapp): create EventsFeedContent without card wrapper"
```

---

### Task 5: Update page.tsx to use new UserDashboard component

**Files:**

- Modify: `packages/webapp/app/page.tsx`

**Step 1: Replace the old structure with UserDashboard**

Replace the entire file content with:

```tsx
'use client';

import { useState } from 'react';

import ChainStatistics from '@/components/dashboard/chain-statistics';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import ClusterForm from '@/components/validators/cluster-form';
import ClusterOverviewContent from '@/components/validators/cluster-overview-content';
import EventsFeedContent from '@/components/validators/events-feed-content';
import NotificationBanner, { type Notification } from '@/components/validators/notification-banner';
import PerformanceMetricsContent from '@/components/validators/performance-metrics-content';
import UserDashboard from '@/components/validators/user-dashboard';
import { useClusters } from '@/hooks/use-clusters';
import type { Cluster } from '@/types/cluster';
import type { Stats, MissedAttestation, ValidatorEvent } from '@/types/validator';

const demoNotifications: Notification[] = [];

const defaultStats: Stats = {
  performance1h: 99.5,
  balance: 0,
  balanceUsd: 0,
  claimable: 0,
  claimableUsd: 0,
  apyDay: 4.2,
  apyWeek: 4.1,
  apyMonth: 4.0,
  gnoDay: 0,
  gnoWeek: 0,
  gnoMonth: 0,
  xdaiDay: 0,
  xdaiWeek: 0,
  xdaiMonth: 0,
  missedDay: 0,
  missedWeek: 0,
  missedMonth: 0,
  totalDay: 0,
  totalWeek: 0,
  totalMonth: 0,
  gnoPrice: 200,
  lastUpdated: new Date().toISOString(),
};

const emptyMissedAttestations: MissedAttestation[] = [];
const emptyEvents: ValidatorEvent[] = [];

export default function DashboardOverview() {
  const [clusterFormOpen, setClusterFormOpen] = useState(false);
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null);

  const { data: apiClusters, isLoading: clustersLoading, refetch: refetchClusters } = useClusters();

  const clusters: Cluster[] = (apiClusters || []).map((c) => ({
    id: c.id,
    name: c.name,
    visibility: c.visibility,
    ownerId: c.ownerId,
    withdrawalAddresses: [],
    feeRecipientAddress: c.feeRecipientAddress,
    validatorIndices: [],
    validators: [],
    validatorCount: c.validatorCount,
    totalBalance: 0,
    totalEffectiveBalance: 0,
    claimableRewards: 0,
    performance: 0,
    createdAt: c.createdAt,
  }));

  const gnoPrice = defaultStats.gnoPrice;

  const handleAddCluster = () => {
    setEditingClusterId(null);
    setClusterFormOpen(true);
  };

  const handleManageCluster = (clusterId: string) => {
    setEditingClusterId(clusterId);
    setClusterFormOpen(true);
  };

  return (
    <div className="py-3 md:py-8 space-y-4 md:space-y-8">
      <NotificationBanner notifications={demoNotifications} />

      <ChainStatistics gnoPrice={gnoPrice} />

      <UserDashboard
        clusters={clusters}
        isLoading={clustersLoading}
        onAddCluster={handleAddCluster}
      >
        {({ displayCluster, isAllSelected }) => (
          <>
            {displayCluster ? (
              <>
                <ClusterOverviewContent
                  cluster={displayCluster}
                  stats={defaultStats}
                  gnoPrice={gnoPrice}
                  onManage={() => handleManageCluster(displayCluster.id)}
                  showManageButton={!isAllSelected}
                />

                <PerformanceMetricsContent data={emptyMissedAttestations} />

                <EventsFeedContent events={emptyEvents} validators={[]} gnoPrice={gnoPrice} />
              </>
            ) : (
              <div className="p-8 text-center text-muted-foreground">No cluster selected</div>
            )}
          </>
        )}
      </UserDashboard>

      <Sheet open={clusterFormOpen} onOpenChange={setClusterFormOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetTitle className="sr-only">
            {editingClusterId ? 'Manage Cluster' : 'Add Cluster'}
          </SheetTitle>
          <div className="mt-6">
            <ClusterForm
              clusterId={editingClusterId}
              onClose={() => setClusterFormOpen(false)}
              onSaved={() => refetchClusters()}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

**Step 2: Verify the app compiles**

Run: `cd packages/webapp && npx tsc --noEmit`
Expected: No errors

**Step 3: Run the dev server and verify visually**

Run: `cd packages/webapp && npm run dev`
Expected: App loads without errors, new dashboard layout is visible

**Step 4: Commit**

```bash
git add packages/webapp/app/page.tsx
git commit -m "feat(webapp): integrate UserDashboard with unified layout"
```

---

### Task 6: Clean up old components (optional - can be done later)

**Files:**

- Delete or deprecate: `packages/webapp/components/validators/cluster-controls.tsx`
- Delete or deprecate: `packages/webapp/components/validators/cluster-list.tsx`

**Step 1: Remove imports and delete files if no longer needed**

Check if these files are imported elsewhere:

Run: `grep -r "cluster-controls" packages/webapp --include="*.tsx" --include="*.ts"`
Run: `grep -r "cluster-list" packages/webapp --include="*.tsx" --include="*.ts"`

If only used in page.tsx (which we already updated), delete them:

```bash
rm packages/webapp/components/validators/cluster-controls.tsx
rm packages/webapp/components/validators/cluster-list.tsx
```

**Step 2: Commit cleanup**

```bash
git add -A
git commit -m "chore(webapp): remove deprecated cluster-controls and cluster-list components"
```

---

## Summary

After completing all tasks:

1. New `UserDashboard` component with sticky cluster tabs
2. New `ClusterOverviewContent` component (without card wrapper)
3. New `PerformanceMetricsContent` component (without card wrapper)
4. New `EventsFeedContent` component (without card wrapper)
5. Updated `page.tsx` to use the new unified layout
6. Old components cleaned up
