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

      <UserDashboard
        clusters={clusters}
        isLoading={clustersLoading}
        onAddCluster={() => setClusterFormOpen(true)}
      >
        {({ displayCluster, isAllSelected }) => (
          <>
            {displayCluster && (
              <ClusterOverviewContent
                cluster={displayCluster}
                stats={defaultStats}
                gnoPrice={gnoPrice}
                showManageButton={!isAllSelected}
                onManage={() => setManagingClusterId(displayCluster.id)}
              />
            )}
            <PerformanceMetricsContent data={emptyMissedAttestations} />
            <EventsFeedContent events={emptyEvents} validators={[]} gnoPrice={gnoPrice} />
          </>
        )}
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
