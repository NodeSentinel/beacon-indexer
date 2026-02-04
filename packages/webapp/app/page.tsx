'use client';

import { useState } from 'react';

import ChainStatistics from '@/components/dashboard/chain-statistics';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import ClusterControls from '@/components/validators/cluster-controls';
import ClusterForm from '@/components/validators/cluster-form';
import ClusterList from '@/components/validators/cluster-list';
import EventsFeed from '@/components/validators/events-feed';
import NotificationBanner, { type Notification } from '@/components/validators/notification-banner';
import PerformanceMetrics from '@/components/validators/performance-metrics';
import { useClusters } from '@/hooks/use-clusters';
import type { Cluster, ClusterFilter } from '@/types/cluster';
import type { Stats, MissedAttestation, ValidatorEvent } from '@/types/validator';

const demoNotifications: Notification[] = [];

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

  return (
    <div className="py-3 md:py-8 space-y-4 md:space-y-8">
      <NotificationBanner notifications={demoNotifications} />

      <ChainStatistics gnoPrice={gnoPrice} />

      <ClusterControls
        clusters={clusters}
        selectedCluster={selectedCluster}
        onClusterChange={setSelectedCluster}
        onAddCluster={() => setClusterFormOpen(true)}
      />

      <ClusterList
        clusters={clusters}
        selectedFilter={selectedCluster}
        stats={defaultStats}
        gnoPrice={gnoPrice}
        isLoading={clustersLoading}
        onClusterEdited={() => refetchClusters()}
        onAddCluster={() => setClusterFormOpen(true)}
      />

      {/* Performance Metrics */}
      <PerformanceMetrics data={emptyMissedAttestations} />

      {/* Events Feed */}
      <EventsFeed events={emptyEvents} validators={[]} gnoPrice={gnoPrice} />

      <Sheet open={clusterFormOpen} onOpenChange={setClusterFormOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetTitle className="sr-only">Add Cluster</SheetTitle>
          <div className="mt-6">
            <ClusterForm
              clusterId={null}
              onClose={() => setClusterFormOpen(false)}
              onSaved={() => refetchClusters()}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
