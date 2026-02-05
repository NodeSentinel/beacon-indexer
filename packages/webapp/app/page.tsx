'use client';

import { useState, useMemo } from 'react';

import ChainStatistics from '@/components/dashboard/chain-statistics';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import ClusterForm from '@/components/validators/cluster-form';
import ClusterOverviewContent from '@/components/validators/cluster-overview-content';
import EventsFeedContent from '@/components/validators/events-feed-content';
import NotificationBanner, { type Notification } from '@/components/validators/notification-banner';
import PerformanceMetricsContent from '@/components/validators/performance-metrics-content';
import UserDashboard from '@/components/validators/user-dashboard';
import { useClusters, useCluster } from '@/hooks/use-clusters';
import { CLUSTER_FILTER_ALL, type Cluster, type ClusterFilter } from '@/types/cluster';
import type { Stats, MissedAttestation, ValidatorEvent } from '@/types/validator';

const demoNotifications: Notification[] = [];

// Beacon API status codes to UI status mapping
const BEACON_STATUS_MAP: Record<
  number,
  'pending' | 'active' | 'active_exiting' | 'slashed' | 'exited' | 'inactive'
> = {
  0: 'pending', // pending_initialized
  1: 'pending', // pending_queued
  2: 'active', // active_ongoing
  3: 'active_exiting', // active_exiting
  4: 'slashed', // active_slashed
  5: 'exited', // exited_unslashed
  6: 'slashed', // exited_slashed
  7: 'exited', // withdrawal_possible
  8: 'exited', // withdrawal_done
};

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
  const [clusterFormOpen, setClusterFormOpen] = useState(false);
  const [managingClusterId, setManagingClusterId] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterFilter>(CLUSTER_FILTER_ALL);

  const { data: apiClusters, isLoading: clustersLoading, refetch: refetchClusters } = useClusters();

  // Fetch detailed cluster data when a specific cluster is selected
  const selectedClusterId = selectedCluster !== CLUSTER_FILTER_ALL ? selectedCluster : null;
  const { data: clusterDetail, isLoading: clusterDetailLoading } = useCluster(selectedClusterId);

  // Transform API clusters to UI format (basic info for tabs)
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

  // Transform detailed cluster data when available
  const detailedCluster: Cluster | null = useMemo(() => {
    if (!clusterDetail) return null;

    return {
      id: clusterDetail.id,
      name: clusterDetail.name,
      visibility: clusterDetail.visibility,
      ownerId: clusterDetail.ownerId,
      withdrawalAddresses: clusterDetail.withdrawalAddresses,
      feeRecipientAddress: clusterDetail.feeRecipientAddress,
      validatorIndices: clusterDetail.validators.map((v) => v.validatorIndex),
      validators: clusterDetail.validators.map((v) => ({
        id: v.validatorIndex.toString(),
        index: v.validatorIndex,
        pubkey: v.pubkey || '',
        status: v.status !== null ? BEACON_STATUS_MAP[v.status] || 'inactive' : 'inactive',
        balance: parseFloat(v.balance),
        effectiveBalance: v.effectiveBalance ? parseFloat(v.effectiveBalance) : 0,
        performance: 0, // TODO: fetch from performance API
        missedAttestations: 0,
        groupId: clusterDetail.id,
        clusterId: clusterDetail.id,
      })),
      validatorCount: clusterDetail.validators.length,
      totalBalance: parseFloat(clusterDetail.totalBalance),
      totalEffectiveBalance: parseFloat(clusterDetail.totalEffectiveBalance),
      claimableRewards: 0, // TODO: calculate from withdrawal data
      performance: 0, // TODO: fetch from performance API
      createdAt: clusterDetail.createdAt,
    };
  }, [clusterDetail]);

  const gnoPrice = defaultStats.gnoPrice;

  return (
    <div className="py-3 md:py-8 space-y-4 md:space-y-8">
      <NotificationBanner notifications={demoNotifications} />

      <ChainStatistics gnoPrice={gnoPrice} />

      <UserDashboard
        clusters={clusters}
        isLoading={clustersLoading}
        onAddCluster={() => setClusterFormOpen(true)}
        hideAllTab={true}
        selectedCluster={selectedCluster}
        onClusterChange={setSelectedCluster}
      >
        {({ isAllSelected }) => {
          // Use detailed cluster when available, fallback to basic cluster info
          const displayCluster =
            detailedCluster || clusters.find((c) => c.id === selectedCluster) || null;
          const isLoadingCluster = clusterDetailLoading && selectedCluster !== CLUSTER_FILTER_ALL;

          return (
            <>
              {isLoadingCluster ? (
                <div className="p-4 md:p-6">
                  <div className="animate-pulse space-y-4">
                    <div className="h-8 bg-foreground/5 rounded w-1/3" />
                    <div className="h-24 bg-foreground/5 rounded" />
                    <div className="h-48 bg-foreground/5 rounded" />
                  </div>
                </div>
              ) : displayCluster ? (
                <ClusterOverviewContent
                  cluster={displayCluster}
                  stats={defaultStats}
                  gnoPrice={gnoPrice}
                  showManageButton={!isAllSelected}
                  onManage={() => setManagingClusterId(displayCluster.id)}
                />
              ) : null}
              <PerformanceMetricsContent data={emptyMissedAttestations} />
              <EventsFeedContent events={emptyEvents} validators={[]} gnoPrice={gnoPrice} />
            </>
          );
        }}
      </UserDashboard>

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

      <Sheet
        open={!!managingClusterId}
        onOpenChange={(open) => !open && setManagingClusterId(null)}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetTitle className="sr-only">Manage Cluster</SheetTitle>
          <div className="mt-6">
            <ClusterForm
              clusterId={managingClusterId}
              onClose={() => setManagingClusterId(null)}
              onSaved={() => refetchClusters()}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
