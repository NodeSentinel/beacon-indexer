'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import ClusterForm from './cluster-form';
import ClusterOverview from './cluster-overview';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { CLUSTER_FILTER_ALL, type Cluster, type ClusterFilter } from '@/types/cluster';
import type { Stats } from '@/types/validator';

interface ClusterListProps {
  clusters: Cluster[];
  selectedFilter: ClusterFilter;
  stats: Stats;
  gnoPrice: number;
  isLoading?: boolean;
  onClusterEdited?: () => void;
  onAddCluster?: () => void;
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
    totalBalance,
    totalEffectiveBalance,
    claimableRewards: totalClaimable,
    performance: avgPerformance,
  };
}

export default function ClusterList({
  clusters,
  selectedFilter,
  stats,
  gnoPrice,
  isLoading,
  onClusterEdited,
  onAddCluster,
}: ClusterListProps) {
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const handleManage = (clusterId: string) => {
    setSelectedClusterId(clusterId);
    setIsFormOpen(true);
  };

  // Loading state
  if (isLoading) {
    return <ClusterListSkeleton />;
  }

  // Empty state
  if (clusters.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <p className="text-muted-foreground mb-4">No clusters found. Create one to get started.</p>
        {onAddCluster && (
          <Button onClick={onAddCluster}>
            <Plus className="size-4 mr-2" />
            Create Your First Cluster
          </Button>
        )}
      </div>
    );
  }

  const isAllClustersSelected = selectedFilter === CLUSTER_FILTER_ALL;

  const displayCluster = isAllClustersSelected
    ? getAggregatedCluster(clusters)
    : clusters.find((c) => c.id === selectedFilter) || clusters[0];

  if (!displayCluster) {
    return null;
  }

  return (
    <>
      <ClusterOverview
        cluster={displayCluster}
        stats={stats}
        gnoPrice={gnoPrice}
        onManage={() => handleManage(displayCluster.id)}
        showManageButton={!isAllClustersSelected}
      />

      {onClusterEdited && (
        <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
          <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
            <SheetTitle className="sr-only">
              {selectedClusterId ? 'Manage Cluster' : 'Add Cluster'}
            </SheetTitle>
            <div className="mt-6">
              <ClusterForm
                clusterId={selectedClusterId}
                onClose={() => setIsFormOpen(false)}
                onSaved={onClusterEdited}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

function ClusterListSkeleton() {
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
