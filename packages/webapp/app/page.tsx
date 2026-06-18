'use client';

import { useMemo, useState } from 'react';

import ClusterForm from '@/components/cluster/cluster-form';
import NotificationBanner, { type Notification } from '@/components/cluster/notification-banner';
import UserDashboard from '@/components/cluster/user-dashboard';
import ChainStatistics from '@/components/dashboard/chain-statistics';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useClusters } from '@/hooks/use-clusters';
import { toClusterList } from '@/lib/cluster-adapter';
import { useUserId } from '@/lib/user-id';
import { cn } from '@/lib/utils';
import { CLUSTER_FILTER_ALL, type ClusterFilter } from '@/types/cluster';

const demoNotifications: Notification[] = [];

export default function DashboardOverview() {
  const [clusterFormOpen, setClusterFormOpen] = useState(false);
  const [managingClusterId, setManagingClusterId] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterFilter>(CLUSTER_FILTER_ALL);

  const userId = useUserId();
  const { data: apiClusters, isLoading: clustersLoading, refetch: refetchClusters } = useClusters();

  const clusters = useMemo(() => toClusterList(apiClusters || []), [apiClusters]);
  const hasNoClusters = !!userId && !clustersLoading && clusters.length === 0;

  return (
    <div className="py-3 md:py-8 space-y-4 md:space-y-8">
      <NotificationBanner notifications={demoNotifications} />

      <ChainStatistics />

      <div className={cn(hasNoClusters && 'pt-4 md:pt-0')}>
        <UserDashboard
          clusters={clusters}
          isLoading={!userId || clustersLoading}
          onAddCluster={() => setClusterFormOpen(true)}
          onManageCluster={setManagingClusterId}
          hideAllTab={true}
          selectedCluster={selectedCluster}
          onClusterChange={setSelectedCluster}
        />
      </div>

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
