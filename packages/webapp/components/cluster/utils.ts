import type { Cluster } from '@/types/cluster';

export interface ClusterStatusDisplay {
  color: string;
  count: number;
  emoji: string;
  label: string;
}

/** Builds validator status display metadata from cluster validators. */
export function getClusterStatusDisplay(validators: Cluster['validators']): ClusterStatusDisplay[] {
  const statusCounts = validators.reduce(
    (acc, validator) => {
      acc[validator.status] = (acc[validator.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const displays: ClusterStatusDisplay[] = [];

  if (statusCounts.active) {
    displays.push({
      emoji: '🟢',
      count: statusCounts.active,
      label: 'active',
      color: 'text-success',
    });
  }

  if (statusCounts.inactive) {
    displays.push({
      emoji: '🟡',
      count: statusCounts.inactive,
      label: 'inactive',
      color: 'text-warning',
    });
  }

  if (statusCounts.active_exiting) {
    displays.push({
      emoji: '🟠',
      count: statusCounts.active_exiting,
      label: 'active exiting',
      color: 'text-orange-500',
    });
  }

  if (statusCounts.slashed) {
    displays.push({
      emoji: '🚫',
      count: statusCounts.slashed,
      label: 'slashed',
      color: 'text-destructive',
    });
  }

  if (statusCounts.exited) {
    displays.push({
      emoji: '🔚',
      count: statusCounts.exited,
      label: 'exited',
      color: 'text-muted-foreground',
    });
  }

  return displays;
}
