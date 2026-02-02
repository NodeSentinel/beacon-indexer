'use client';

import { useState } from 'react';

import ClusterForm from './cluster-form';
import ClusterOverview from './cluster-overview';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { Cluster, ClusterFilter, Stats } from '@/types/validator';

interface ClusterListProps {
  clusters: Cluster[];
  selectedFilter: ClusterFilter;
  stats: Stats;
  gnoPrice: number;
  onSaveCluster?: (
    clusterId: string | null,
    data: {
      name: string;
      visibility: 'private' | 'shared';
      feeRecipientAddress: string | null;
      validatorIndexes: number[];
    },
  ) => void;
  onDeleteCluster?: (id: string) => void;
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
  onSaveCluster,
  onDeleteCluster,
}: ClusterListProps) {
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const handleManage = (cluster: Cluster) => {
    setSelectedCluster(cluster);
    setIsFormOpen(true);
  };

  const displayCluster =
    selectedFilter === 'all'
      ? getAggregatedCluster(clusters)
      : clusters.find((c) => c.id === selectedFilter) || clusters[0];

  const handleSave = (data: {
    name: string;
    visibility: 'private' | 'shared';
    feeRecipientAddress: string | null;
    validatorIndexes: number[];
  }) => {
    if (onSaveCluster) {
      onSaveCluster(selectedCluster?.id || null, data);
    }
    setIsFormOpen(false);
  };

  const handleDelete = (id: string) => {
    if (onDeleteCluster) {
      onDeleteCluster(id);
    }
    setIsFormOpen(false);
  };

  if (!displayCluster) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No clusters found. Create one to get started.
      </div>
    );
  }

  return (
    <>
      <ClusterOverview
        cluster={displayCluster}
        stats={stats}
        gnoPrice={gnoPrice}
        onManage={() => handleManage(displayCluster)}
      />

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <div className="mt-6">
            <ClusterForm
              cluster={selectedCluster}
              onClose={() => setIsFormOpen(false)}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
