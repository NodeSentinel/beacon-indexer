'use client';

import { Plus, Server } from 'lucide-react';
import { useState, useMemo } from 'react';

import ChainStatistics from '@/components/dashboard/chain-statistics';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import AnalyticsContent from '@/components/validators/analytics-content';
import ClusterForm from '@/components/validators/cluster-form';
import ClusterOverviewContent from '@/components/validators/cluster-overview-content';
import EventsFeedContent from '@/components/validators/events-feed-content';
import NotificationBanner, { type Notification } from '@/components/validators/notification-banner';
import UserDashboard from '@/components/validators/user-dashboard';
import { useChainStats } from '@/hooks/use-chain-stats';
import { useClusterSnapshot } from '@/hooks/use-cluster-snapshot';
import { useClusters, useCluster } from '@/hooks/use-clusters';
import { CLUSTER_FILTER_ALL, type Cluster, type ClusterFilter } from '@/types/cluster';
import type { MissedAttestation, ValidatorEvent } from '@/types/validator';

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

// Empty data for charts while we don't have the API
const emptyMissedAttestations: MissedAttestation[] = [];
const emptyEvents: ValidatorEvent[] = [];

export default function DashboardOverview() {
  const [clusterFormOpen, setClusterFormOpen] = useState(false);
  const [managingClusterId, setManagingClusterId] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterFilter>(CLUSTER_FILTER_ALL);

  const { data: chainStats } = useChainStats();
  const { data: apiClusters, isLoading: clustersLoading, refetch: refetchClusters } = useClusters();

  // Fetch detailed cluster data when a specific cluster is selected
  const selectedClusterId = selectedCluster !== CLUSTER_FILTER_ALL ? selectedCluster : null;
  const { data: clusterDetail, isLoading: clusterDetailLoading } = useCluster(selectedClusterId);
  const { data: clusterSnapshot, isLoading: snapshotLoading } =
    useClusterSnapshot(selectedClusterId);

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

  const tokenPrice = chainStats?.tokenPrice ?? 0;

  return (
    <div className="py-3 md:py-8 space-y-4 md:space-y-8">
      <NotificationBanner notifications={demoNotifications} />

      <ChainStatistics />

      {!clustersLoading && clusters.length === 0 ? (
        <div className="border border-border/60 rounded-lg p-8 md:p-12 flex flex-col items-center text-center space-y-4">
          <Server className="size-10 text-muted-foreground" />
          <h2 className="text-xl md:text-2xl font-display">Create your first cluster</h2>
          <p className="text-muted-foreground max-w-md text-sm md:text-base">
            A cluster represents a physical machine running a group of validators. Create one per
            machine you operate. If you are a solo staker, you probably only need one.
          </p>
          <Button onClick={() => setClusterFormOpen(true)} className="mt-2">
            <Plus className="size-4 mr-2" />
            Add Cluster
          </Button>
        </div>
      ) : (
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
              <div className="px-2 py-4 md:p-6 space-y-4 md:space-y-5">
                {isLoadingCluster ? (
                  <div className="animate-pulse space-y-4">
                    <div className="h-8 bg-foreground/5 rounded w-1/3" />
                    <div className="h-24 bg-foreground/5 rounded" />
                    <div className="h-48 bg-foreground/5 rounded" />
                  </div>
                ) : displayCluster ? (
                  <ClusterOverviewContent
                    cluster={displayCluster}
                    snapshot={clusterSnapshot ?? null}
                    snapshotLoading={snapshotLoading}
                    gnoPrice={tokenPrice}
                    showManageButton={!isAllSelected}
                    onManage={() => setManagingClusterId(displayCluster.id)}
                  />
                ) : null}
                <AnalyticsContent data={emptyMissedAttestations} />
                <EventsFeedContent
                  clusterId={selectedClusterId}
                  events={emptyEvents}
                  validators={[]}
                  gnoPrice={tokenPrice}
                />
              </div>
            );
          }}
        </UserDashboard>
      )}

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
              onDeleted={() => {
                if (selectedCluster === managingClusterId) {
                  setSelectedCluster(CLUSTER_FILTER_ALL);
                }
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
