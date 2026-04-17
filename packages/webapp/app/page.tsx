'use client';

import { useMemo, useState } from 'react';

import ChainStatistics from '@/components/dashboard/chain-statistics';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import ClusterForm from '@/components/validators/cluster-form';
import NotificationBanner, { type Notification } from '@/components/validators/notification-banner';
import UserDashboard from '@/components/validators/user-dashboard';
import { useClusters } from '@/hooks/use-clusters';
import { toClusterList } from '@/lib/cluster-adapter';
import { useUserId } from '@/lib/user-id';
import { CLUSTER_FILTER_ALL, type ClusterFilter } from '@/types/cluster';

const demoNotifications: Notification[] = [];

export default function DashboardOverview() {
  const [clusterFormOpen, setClusterFormOpen] = useState(false);
  const [managingClusterId, setManagingClusterId] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterFilter>(CLUSTER_FILTER_ALL);

  const userId = useUserId();
  const { data: apiClusters, isLoading: clustersLoading, refetch: refetchClusters } = useClusters();

  const clusters = useMemo(() => toClusterList(apiClusters || []), [apiClusters]);

  return (
    <div className="py-3 md:py-8 space-y-4 md:space-y-8">
      <NotificationBanner notifications={demoNotifications} />

      <ChainStatistics />

      <UserDashboard
        clusters={clusters}
        isLoading={!userId || clustersLoading}
        onAddCluster={() => setClusterFormOpen(true)}
        onManageCluster={setManagingClusterId}
        hideAllTab={true}
        selectedCluster={selectedCluster}
        onClusterChange={setSelectedCluster}
      />

      {/* Add cluster */}
      <Sheet open={clusterFormOpen} onOpenChange={setClusterFormOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetTitle className="sr-only">Add Cluster</SheetTitle>
          <div className="mt-6">
            <ClusterForm
              key="create-cluster-form"
              clusterId={null}
              onClose={() => setClusterFormOpen(false)}
              onSaved={() => refetchClusters()}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Manage cluster */}
      <Sheet
        open={!!managingClusterId}
        onOpenChange={(open) => !open && setManagingClusterId(null)}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetTitle className="sr-only">Manage Cluster</SheetTitle>
          <div className="mt-6">
            <ClusterForm
              // Remounts the editor when a different cluster opens so local draft state stays isolated.
              key={managingClusterId ?? 'manage-cluster-form'}
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
