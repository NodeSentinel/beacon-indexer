'use client';

import { Users, Coins, ArrowUpCircle, ArrowDownCircle, Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import ClusterForm from '@/components/validators/cluster-form';
import ClusterList from '@/components/validators/cluster-list';
import EventsFeed from '@/components/validators/events-feed';
import NotificationBanner, { type Notification } from '@/components/validators/notification-banner';
import PerformanceMetrics from '@/components/validators/performance-metrics';
import { useClusters } from '@/hooks/use-clusters';
import type {
  Cluster,
  ClusterFilter,
  Stats,
  MissedAttestation,
  ValidatorEvent,
} from '@/types/validator';

const demoNotifications: Notification[] = [];

// Format number with consistent locale (prevents SSR hydration mismatch)
const formatNumber = (n: number, decimals = 0) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(n);

// Default stats while we don't have a stats API
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

// Empty data for charts while we don't have the API
const emptyMissedAttestations: MissedAttestation[] = [];
const emptyEvents: ValidatorEvent[] = [];

export default function DashboardOverview() {
  const [selectedCluster, setSelectedCluster] = useState<ClusterFilter>('all');
  const [clusterFormOpen, setClusterFormOpen] = useState(false);

  const { data: apiClusters, isLoading: clustersLoading, refetch: refetchClusters } = useClusters();

  // Transform API clusters to UI format
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

  // Chain stats (placeholder - these would come from a chain stats API)
  const totalStakedGno = 350000;
  const activeValidators = 450450;
  const joiningValidators = 2300;
  const leavingValidators = 500;

  const activeStakedGno = activeValidators * 32;
  const joiningStakedGno = joiningValidators * 32;
  const leavingStakedGno = leavingValidators * 32;

  const totalStakedUsd = formatNumber(totalStakedGno * gnoPrice);
  const activeStakedUsd = formatNumber(activeStakedGno * gnoPrice);
  const joiningStakedUsd = formatNumber(joiningStakedGno * gnoPrice);
  const leavingStakedUsd = formatNumber(leavingStakedGno * gnoPrice);

  return (
    <div className="py-3 md:py-8 space-y-4 md:space-y-8">
      <NotificationBanner notifications={demoNotifications} />

      {/* Chain Statistics */}
      <div className="space-y-2">
        <h2 className="text-[10px] md:text-xs font-display text-muted-foreground uppercase tracking-wider">
          Chain Statistics
        </h2>
        <div className="bg-muted/30 border border-border/50 rounded-lg p-2.5 md:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-5">
            {/* Active Validators Card */}
            <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4">
              <div className="flex items-start gap-2 md:gap-3">
                <div className="p-1.5 md:p-2 bg-chart-2/10 rounded-lg">
                  <Users className="w-3.5 h-3.5 md:w-4 md:h-4 text-chart-2" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide mb-0.5 md:mb-1">
                    Active
                  </p>
                  <p className="text-xl md:text-2xl font-display font-bold text-foreground truncate">
                    {formatNumber(activeValidators)}
                  </p>
                  <p className="text-[10px] md:text-xs text-muted-foreground/80 mt-0.5">
                    ${activeStakedUsd}
                  </p>
                </div>
              </div>
            </div>

            {/* Staked GNO Card */}
            <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4">
              <div className="flex items-start gap-2 md:gap-3">
                <div className="p-1.5 md:p-2 bg-primary/10 rounded-lg">
                  <Coins className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide mb-0.5 md:mb-1">
                    Staked
                  </p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl md:text-2xl font-display font-bold text-foreground">
                      {(totalStakedGno / 1000).toFixed(0)}k
                    </span>
                    <span className="text-xs md:text-sm text-muted-foreground font-medium">
                      GNO
                    </span>
                  </div>
                  <p className="text-[10px] md:text-xs text-muted-foreground/80 mt-0.5">
                    ${totalStakedUsd}
                  </p>
                </div>
              </div>
            </div>

            {/* Joining/Leaving Card */}
            <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4 sm:col-span-2 lg:col-span-1">
              <div className="grid grid-cols-2 gap-3 md:gap-4">
                <div className="flex flex-col gap-1.5 md:gap-2">
                  <div className="flex items-center gap-1.5 md:gap-2">
                    <div className="p-1 md:p-1.5 bg-chart-2/10 rounded">
                      <ArrowUpCircle className="w-3 h-3 md:w-3.5 md:h-3.5 text-chart-2" />
                    </div>
                    <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide">
                      Joining
                    </span>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1">
                      <p className="text-lg md:text-2xl font-display font-bold text-white">2.3k</p>
                      <span className="text-xs text-white/80">GNO</span>
                    </div>
                    <p className="text-[10px] md:text-xs text-muted-foreground/80 mt-0.5">
                      ${joiningStakedUsd}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 md:gap-2">
                  <div className="flex items-center gap-1.5 md:gap-2">
                    <div className="p-1 md:p-1.5 bg-warning/10 rounded">
                      <ArrowDownCircle className="w-3 h-3 md:w-3.5 md:h-3.5 text-warning" />
                    </div>
                    <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide">
                      Leaving
                    </span>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1">
                      <p className="text-lg md:text-2xl font-display font-bold text-white">500</p>
                      <span className="text-xs text-white/80">GNO</span>
                    </div>
                    <p className="text-[10px] md:text-xs text-muted-foreground/80 mt-0.5">
                      ${leavingStakedUsd}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* User Dashboard */}
      <div className="space-y-2.5 md:space-y-3">
        <h2 className="text-[10px] md:text-xs font-display text-primary uppercase tracking-wider">
          User Dashboard
        </h2>
        <div className="bg-card border border-border rounded-lg p-3 md:p-6">
          <div className="flex items-end gap-3">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 md:mb-2 block">
                Select Cluster
              </label>
              <Select
                value={selectedCluster}
                onValueChange={(value) => setSelectedCluster(value as ClusterFilter)}
              >
                <SelectTrigger className="w-full h-10 text-base font-medium border-2 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-base">
                    All Clusters
                  </SelectItem>
                  {clusters.map((cluster) => (
                    <SelectItem key={cluster.id} value={cluster.id} className="text-base">
                      {cluster.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              className="h-10 bg-transparent shrink-0"
              onClick={() => setClusterFormOpen(true)}
            >
              <Plus className="size-4 mr-2" />
              Add Cluster
            </Button>
          </div>
        </div>
      </div>

      {/* Cluster Data with Skeleton */}
      {clustersLoading ? (
        <ClusterDataSkeleton />
      ) : clusters.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground mb-4">
            No clusters found. Create one to get started.
          </p>
          <Button onClick={() => setClusterFormOpen(true)}>
            <Plus className="size-4 mr-2" />
            Create Your First Cluster
          </Button>
        </div>
      ) : (
        <ClusterList
          clusters={clusters}
          selectedFilter={selectedCluster}
          stats={defaultStats}
          gnoPrice={gnoPrice}
          onClusterChanged={() => refetchClusters()}
        />
      )}

      {/* Performance Metrics */}
      <PerformanceMetrics data={emptyMissedAttestations} />

      {/* Events Feed */}
      <EventsFeed events={emptyEvents} validators={[]} gnoPrice={gnoPrice} />

      <Sheet open={clusterFormOpen} onOpenChange={setClusterFormOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <div className="mt-6">
            <ClusterForm
              cluster={null}
              onClose={() => setClusterFormOpen(false)}
              onSaved={() => refetchClusters()}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ClusterDataSkeleton() {
  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="px-4 py-3 min-h-[52px] flex items-center justify-between border-b border-border">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Validators by status */}
        <div className="flex items-center gap-3 md:gap-4 flex-wrap pb-2.5 md:pb-3 border-b border-border/50">
          <Skeleton className="h-4 w-24" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>

        {/* Balances */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-4 pb-3.5 md:pb-4 border-b border-border">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>

        {/* Performance */}
        <div className="pb-3.5 md:pb-4 border-b border-border">
          <Skeleton className="h-3 w-24 mb-2.5 md:mb-3" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="space-y-3">
          <div className="grid grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
          {[1, 2, 3].map((row) => (
            <div key={row} className="grid grid-cols-6 gap-4">
              {[1, 2, 3, 4, 5, 6].map((col) => (
                <Skeleton key={col} className="h-6 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
