'use client';

import { Plus } from 'lucide-react';
import { useState, useEffect, useRef, useMemo } from 'react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { CLUSTER_FILTER_ALL, type Cluster, type ClusterFilter } from '@/types/cluster';

interface UserDashboardProps {
  clusters: Cluster[];
  isLoading?: boolean;
  onAddCluster: () => void;
  hideAllTab?: boolean;
  selectedCluster?: ClusterFilter;
  onClusterChange?: (clusterId: ClusterFilter) => void;
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
    id: CLUSTER_FILTER_ALL,
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
  hideAllTab = false,
  selectedCluster: controlledSelectedCluster,
  onClusterChange,
  children,
}: UserDashboardProps) {
  // Internal state for uncontrolled mode
  const [internalSelectedCluster, setInternalSelectedCluster] =
    useState<ClusterFilter>(CLUSTER_FILTER_ALL);
  const [isSticky, setIsSticky] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Use controlled or uncontrolled state
  const isControlled = controlledSelectedCluster !== undefined;
  const selectedCluster = isControlled ? controlledSelectedCluster : internalSelectedCluster;
  const setSelectedCluster = isControlled
    ? (value: ClusterFilter) => onClusterChange?.(value)
    : setInternalSelectedCluster;

  // Auto-select first cluster when hideAllTab is true and clusters are loaded
  useEffect(() => {
    if (hideAllTab && clusters.length > 0 && selectedCluster === CLUSTER_FILTER_ALL) {
      setSelectedCluster(clusters[0].id);
    }
  }, [hideAllTab, clusters, selectedCluster, setSelectedCluster]);

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
  const displayCluster = useMemo(() => {
    return isAllSelected
      ? getAggregatedCluster(clusters)
      : clusters.find((c) => c.id === selectedCluster) || null;
  }, [isAllSelected, clusters, selectedCluster]);

  if (isLoading) {
    return <UserDashboardSkeleton />;
  }

  return (
    <div>
      {/* Sentinel element for intersection observer */}
      <div ref={sentinelRef} className="h-0" />

      <Tabs
        value={selectedCluster}
        onValueChange={(value) => setSelectedCluster(value as ClusterFilter)}
        className="flex flex-col gap-0"
      >
        <div
          className={cn(
            'sticky top-0 z-10 transition-shadow duration-200 overflow-x-auto scrollbar-none',
            isSticky && 'shadow-md',
          )}
        >
          <div className="flex items-end justify-between">
            <TabsList className="bg-transparent rounded-none p-0 gap-1 h-auto w-auto items-end">
              {!hideAllTab && (
                <TabsTrigger
                  value={CLUSTER_FILTER_ALL}
                  className={cn(
                    'flex-initial rounded-none rounded-t-lg border border-b-0 border-border/40 bg-muted/40 px-4 md:px-5 py-2 md:py-2.5 text-sm text-muted-foreground hover:bg-muted/60 transition-colors',
                    'data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:border-border/60 data-[state=active]:font-semibold',
                  )}
                >
                  All
                </TabsTrigger>
              )}
              {clusters.map((cluster) => (
                <TabsTrigger
                  key={cluster.id}
                  value={cluster.id}
                  className={cn(
                    'flex-initial rounded-none rounded-t-lg border border-b-0 border-border/40 bg-muted/40 px-4 md:px-5 py-2 md:py-2.5 text-sm text-muted-foreground hover:bg-muted/60 transition-colors',
                    'data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:border-border/60 data-[state=active]:font-semibold',
                  )}
                >
                  {cluster.name}
                </TabsTrigger>
              ))}
            </TabsList>
            <button
              onClick={(e) => {
                e.preventDefault();
                onAddCluster();
              }}
              aria-label="Add cluster"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-0.5 mr-2 text-sm font-medium rounded-md border border-border/60 bg-transparent hover:bg-muted/40 transition-colors whitespace-nowrap"
            >
              <Plus className="size-3.5" />
              Add Cluster
            </button>
          </div>
        </div>

        <TabsContent
          value={selectedCluster}
          className="m-0 border border-border/60 rounded-b-lg rounded-tr-lg"
        >
          {children({ selectedCluster, displayCluster, isAllSelected })}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UserDashboardSkeleton() {
  return (
    <div>
      <div className="flex gap-0">
        <div className="h-10 w-24 border border-border/60 border-b-0 rounded-t-lg animate-pulse" />
        <div className="h-10 w-28 bg-foreground/5 rounded-t-lg animate-pulse" />
      </div>
      <div className="border border-border/60 rounded-b-lg rounded-tr-lg p-4 space-y-4">
        <div className="h-32 bg-foreground/5 rounded animate-pulse" />
        <div className="h-64 bg-foreground/5 rounded animate-pulse" />
        <div className="h-48 bg-foreground/5 rounded animate-pulse" />
      </div>
    </div>
  );
}
