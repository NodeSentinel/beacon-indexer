'use client';

import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Cluster, ClusterFilter } from '@/types/cluster';

interface ClusterControlsProps {
  clusters: Cluster[];
  selectedCluster: ClusterFilter;
  onClusterChange: (value: ClusterFilter) => void;
  onAddCluster: () => void;
}

export default function ClusterControls({
  clusters,
  selectedCluster,
  onClusterChange,
  onAddCluster,
}: ClusterControlsProps) {
  return (
    <div className="space-y-2.5 md:space-y-3">
      <h2 className="text-[10px] md:text-xs font-display text-primary uppercase tracking-wider">
        User Dashboard
      </h2>
      <div className="bg-card border border-border rounded-lg p-3 md:p-6 space-y-4">
        {/* Cluster Selection */}
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 md:mb-2 block">
            Select Cluster
          </label>
          <Select
            value={selectedCluster}
            onValueChange={(value) => onClusterChange(value as ClusterFilter)}
          >
            <SelectTrigger className="w-full h-10 text-base font-medium border-2 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-base">
                All Clusters
              </SelectItem>
              {clusters.map((cluster) => (
                <SelectItem key={cluster.id} value={cluster.id} className="text-base">
                  {cluster.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button variant="outline" className="bg-transparent" onClick={onAddCluster}>
            <Plus className="size-4 mr-2" />
            Add Cluster
          </Button>
        </div>
      </div>
    </div>
  );
}
