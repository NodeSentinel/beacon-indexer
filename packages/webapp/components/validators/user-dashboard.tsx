'use client';

import { Plus, Server } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';

import AnalyticsContent from './analytics-content';
import ClusterOverviewContent from './cluster-overview-content';
import EventsFeedContent from './events';

import { Button } from '@/components/ui/button';
import {
  UnderlineTabs,
  UnderlineTabsList,
  UnderlineTabsTrigger,
  UnderlineTabsContent,
} from '@/components/underline-tabs';
import { useCluster } from '@/hooks/use-clusters';
import { toDetailedCluster } from '@/lib/cluster-adapter';
import { CLUSTER_FILTER_ALL, type Cluster, type ClusterFilter } from '@/types/cluster';

interface UserDashboardProps {
  clusters: Cluster[];
  isLoading?: boolean;
  onAddCluster: () => void;
  onManageCluster: (clusterId: string) => void;
  hideAllTab?: boolean;
  selectedCluster?: ClusterFilter;
  onClusterChange?: (clusterId: ClusterFilter) => void;
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
  onManageCluster,
  hideAllTab = false,
  selectedCluster: controlledSelectedCluster,
  onClusterChange,
}: UserDashboardProps) {
  // Internal state for uncontrolled mode
  const [internalSelectedCluster, setInternalSelectedCluster] =
    useState<ClusterFilter>(CLUSTER_FILTER_ALL);
  // Use controlled or uncontrolled state
  const isControlled = controlledSelectedCluster !== undefined;
  const selectedCluster = isControlled ? controlledSelectedCluster : internalSelectedCluster;
  const setSelectedCluster = isControlled
    ? (value: ClusterFilter) => onClusterChange?.(value)
    : setInternalSelectedCluster;

  const selectedClusterId = selectedCluster !== CLUSTER_FILTER_ALL ? selectedCluster : null;
  const { data: clusterDetail, isLoading: clusterDetailLoading } = useCluster(selectedClusterId);

  // Auto-select first cluster when hideAllTab is true and clusters are loaded
  useEffect(() => {
    if (hideAllTab && clusters.length > 0 && selectedCluster === CLUSTER_FILTER_ALL) {
      setSelectedCluster(clusters[0].id);
    }
  }, [hideAllTab, clusters, selectedCluster, setSelectedCluster]);

  const isAllSelected = selectedCluster === CLUSTER_FILTER_ALL;
  const detailedCluster = useMemo(
    () => (clusterDetail ? toDetailedCluster(clusterDetail) : null),
    [clusterDetail],
  );
  const displayCluster = useMemo(() => {
    if (detailedCluster) return detailedCluster;
    return isAllSelected
      ? getAggregatedCluster(clusters)
      : clusters.find((c) => c.id === selectedCluster) || null;
  }, [isAllSelected, clusters, selectedCluster, detailedCluster]);

  if (isLoading) {
    return <UserDashboardSkeleton />;
  }

  if (clusters.length === 0) {
    return (
      <div className="border border-border/60 rounded-lg p-8 md:p-12 flex flex-col items-center text-center space-y-4">
        <Server className="size-10 text-muted-foreground" />
        <h2 className="text-xl md:text-2xl font-display">Create your first cluster</h2>
        <p className="text-muted-foreground max-w-md text-sm md:text-base">
          A cluster represents a physical machine running a group of validators. Create one per
          machine you operate. If you are a solo staker, you probably only need one.
        </p>
        <Button onClick={onAddCluster} className="mt-2">
          <Plus className="size-4 mr-2" />
          Add Cluster
        </Button>
      </div>
    );
  }

  const isLoadingCluster = clusterDetailLoading && !isAllSelected;

  return (
    <UnderlineTabs
      value={selectedCluster}
      onValueChange={(value) => setSelectedCluster(value as ClusterFilter)}
      className="gap-0"
    >
      <UnderlineTabsList>
        {!hideAllTab && <UnderlineTabsTrigger value={CLUSTER_FILTER_ALL}>All</UnderlineTabsTrigger>}
        {clusters.map((cluster) => (
          <UnderlineTabsTrigger key={cluster.id} value={cluster.id}>
            {cluster.name}
          </UnderlineTabsTrigger>
        ))}
        <UnderlineTabsTrigger
          value="__add_cluster__"
          onClick={(e) => {
            e.preventDefault();
            onAddCluster();
          }}
          aria-label="Add cluster"
        >
          <Plus className="size-3" />
          New
        </UnderlineTabsTrigger>
      </UnderlineTabsList>

      <UnderlineTabsContent value={selectedCluster}>
        <div className="py-4 md:p-6 space-y-4 md:space-y-5">
          {isLoadingCluster ? (
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-foreground/5 rounded w-1/3" />
              <div className="h-24 bg-foreground/5 rounded" />
              <div className="h-48 bg-foreground/5 rounded" />
            </div>
          ) : displayCluster ? (
            <ClusterOverviewContent
              cluster={displayCluster}
              showManageButton={!isAllSelected}
              onManage={() => onManageCluster(displayCluster.id)}
            />
          ) : null}
          <AnalyticsContent clusterFilter={selectedCluster} />
          <EventsFeedContent clusterId={selectedClusterId} />
        </div>
      </UnderlineTabsContent>
    </UnderlineTabs>
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
