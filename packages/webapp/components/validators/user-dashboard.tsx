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
    <div className="bg-card rounded-lg">
      {/* Sentinel element for intersection observer */}
      <div ref={sentinelRef} className="h-0" />

      <Tabs
        value={selectedCluster}
        onValueChange={(value) => setSelectedCluster(value as ClusterFilter)}
        className="flex flex-col"
      >
        <div
          className={cn(
            'sticky top-0 z-10 bg-card rounded-t-lg transition-shadow duration-200 overflow-x-auto scrollbar-none',
            isSticky && 'shadow-md',
          )}
        >
          <TabsList className="bg-transparent p-3 gap-2 h-auto">
            {!hideAllTab && <TabsTrigger value={CLUSTER_FILTER_ALL}>All</TabsTrigger>}
            {clusters.map((cluster) => (
              <TabsTrigger key={cluster.id} value={cluster.id}>
                {cluster.name}
              </TabsTrigger>
            ))}
            <button
              onClick={(e) => {
                e.preventDefault();
                onAddCluster();
              }}
              aria-label="Add cluster"
              className="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-colors"
            >
              <Plus className="size-4" />
            </button>
          </TabsList>
        </div>

        <TabsContent value={selectedCluster} className="m-0">
          {children({ selectedCluster, displayCluster, isAllSelected })}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UserDashboardSkeleton() {
  return (
    <div className="bg-card rounded-lg">
      <div className="p-3">
        <div className="flex gap-2">
          <div className="h-9 w-16 bg-foreground/5 rounded-md animate-pulse" />
          <div className="h-9 w-24 bg-foreground/5 rounded-md animate-pulse" />
          <div className="h-9 w-24 bg-foreground/5 rounded-md animate-pulse" />
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div className="h-32 bg-foreground/5 rounded animate-pulse" />
        <div className="h-64 bg-foreground/5 rounded animate-pulse" />
        <div className="h-48 bg-foreground/5 rounded animate-pulse" />
      </div>
    </div>
  );
}
