'use client';

import { Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ClusterSnapshot } from '@/hooks/use-cluster-snapshot';
import type { Cluster } from '@/types/cluster';

interface ClusterOverviewContentProps {
  cluster: Cluster;
  snapshot: ClusterSnapshot | null;
  snapshotLoading?: boolean;
  gnoPrice: number;
  onManage?: () => void;
  showManageButton?: boolean;
}

const PERIODS = [
  { label: '1H', key: '1h' },
  { label: '1D', key: '1d' },
  { label: '1W', key: '1w' },
  { label: '1M', key: '1m' },
] as const;

type PeriodKey = (typeof PERIODS)[number]['key'];

function formatValue(value: string | null): string {
  if (value === null) return '-';
  const num = parseFloat(value);
  if (isNaN(num)) return '-';
  return num.toFixed(4);
}

function formatPercent(value: number | null): string {
  if (value === null) return '-';
  return `${(value * 100).toFixed(2)}%`;
}

function formatApy(value: number | null): string {
  if (value === null) return '-';
  return `${value.toFixed(2)}%`;
}

export default function ClusterOverviewContent({
  cluster,
  snapshot,
  snapshotLoading,
  gnoPrice,
  onManage,
  showManageButton = false,
}: ClusterOverviewContentProps) {
  const statusCounts = cluster.validators.reduce(
    (acc, v) => {
      acc[v.status] = (acc[v.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const getStatusDisplay = () => {
    const displays: { emoji: string; count: number; label: string; color: string }[] = [];

    if (statusCounts.active)
      displays.push({
        emoji: '🟢',
        count: statusCounts.active,
        label: 'active',
        color: 'text-success',
      });
    if (statusCounts.inactive)
      displays.push({
        emoji: '🟡',
        count: statusCounts.inactive,
        label: 'inactive',
        color: 'text-warning',
      });
    if (statusCounts.active_exiting)
      displays.push({
        emoji: '🟠',
        count: statusCounts.active_exiting,
        label: 'active exiting',
        color: 'text-orange-500',
      });
    if (statusCounts.slashed)
      displays.push({
        emoji: '🚫',
        count: statusCounts.slashed,
        label: 'slashed',
        color: 'text-destructive',
      });
    if (statusCounts.exited)
      displays.push({
        emoji: '🔚',
        count: statusCounts.exited,
        label: 'exited',
        color: 'text-muted-foreground',
      });

    return displays;
  };

  const totalValidators = cluster.validators.length;

  const balanceUsd = (cluster.totalBalance * gnoPrice).toFixed(2);
  const effectiveBalanceUsd = (cluster.totalEffectiveBalance * gnoPrice).toFixed(0);
  const claimableUsd = (cluster.claimableRewards * gnoPrice).toFixed(2);

  const getPerformance = (key: PeriodKey): number | null => {
    if (!snapshot) return null;
    const map: Record<PeriodKey, number | null> = {
      '1h': snapshot.performance1h,
      '1d': snapshot.performance1d,
      '1w': snapshot.performance1w,
      '1m': snapshot.performance1m,
    };
    return map[key];
  };

  const getApy = (key: PeriodKey): number | null => {
    if (!snapshot) return null;
    const map: Record<PeriodKey, number | null> = {
      '1h': snapshot.apy1h,
      '1d': snapshot.apy1d,
      '1w': snapshot.apy1w,
      '1m': snapshot.apy1m,
    };
    return map[key];
  };

  const getConsensusReward = (key: PeriodKey): string | null => {
    if (!snapshot) return null;
    const map: Record<PeriodKey, string | null> = {
      '1h': snapshot.consensusReward1h,
      '1d': snapshot.consensusReward1d,
      '1w': snapshot.consensusReward1w,
      '1m': snapshot.consensusReward1m,
    };
    return map[key];
  };

  const getMissedReward = (key: PeriodKey): string | null => {
    if (!snapshot) return null;
    const map: Record<PeriodKey, string | null> = {
      '1h': snapshot.missedReward1h,
      '1d': snapshot.missedReward1d,
      '1w': snapshot.missedReward1w,
      '1m': snapshot.missedReward1m,
    };
    return map[key];
  };

  const getExecutionReward = (key: PeriodKey): string | null => {
    if (!snapshot) return null;
    const map: Record<PeriodKey, string | null> = {
      '1h': snapshot.executionReward1h,
      '1d': snapshot.executionReward1d,
      '1w': snapshot.executionReward1w,
      '1m': snapshot.executionReward1m,
    };
    return map[key];
  };

  return (
    <div className="border-t border-border/50 p-4 md:p-6">
      <div className="space-y-4 md:space-y-6">
        {/* Unified header: Cluster name, validators status, and manage button */}
        <div className="flex items-center justify-between gap-3 pb-2.5 md:pb-3 border-b border-border/50">
          <div className="flex items-center gap-3 md:gap-4 flex-wrap min-w-0">
            <h2 className="text-lg md:text-xl font-semibold truncate">{cluster.name}</h2>

            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 font-semibold text-xs md:text-sm shrink-0">
              {totalValidators} VALIDATOR{totalValidators !== 1 ? 'S' : ''}
            </span>

            {getStatusDisplay().map((status) => (
              <div key={status.label} className="flex items-center gap-1.5 shrink-0">
                <span className="text-sm">{status.emoji}</span>
                <span className={`text-sm font-semibold ${status.color}`}>{status.count}</span>
                <span className="text-xs text-muted-foreground capitalize hidden sm:inline">
                  {status.label}
                </span>
              </div>
            ))}
          </div>

          {showManageButton && onManage && (
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent shrink-0"
              onClick={onManage}
            >
              <Settings className="size-4 md:mr-2" />
              <span className="hidden md:inline">Manage</span>
            </Button>
          )}
        </div>

        {/* Balances section */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-4 pb-3.5 md:pb-4 border-b border-border">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">BALANCE</p>
            <span className="text-base md:text-xl font-display">
              {cluster.totalBalance.toFixed(2)} GNO
            </span>
            <p className="text-xs text-muted-foreground">${balanceUsd}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">EFFECTIVE BALANCE</p>
            <span className="text-base md:text-xl font-display">
              {cluster.totalEffectiveBalance.toFixed(0)} GNO
            </span>
            <p className="text-xs text-muted-foreground">${effectiveBalanceUsd}</p>
          </div>
          <div className="col-span-2 md:col-span-1">
            <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">CLAIMABLE</p>
            <span className="text-base md:text-xl font-display text-white">
              {cluster.claimableRewards.toFixed(2)} GNO
            </span>
            <p className="text-xs text-muted-foreground">${claimableUsd}</p>
          </div>
        </div>

        {/* Performance metrics */}
        <div className="pb-3.5 md:pb-4 border-b border-border">
          <p className="text-[10px] md:text-xs text-muted-foreground mb-2.5 md:mb-3">PERFORMANCE</p>
          {snapshotLoading ? (
            <div className="animate-pulse h-12 bg-foreground/5 rounded" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
              {PERIODS.map(({ label, key }) => (
                <div key={key}>
                  <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">{label}</p>
                  <span className="text-xl md:text-2xl font-display text-white">
                    {formatPercent(getPerformance(key))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* APY table */}
        <div className="relative -mx-3 px-3 md:mx-0 md:px-0">
          <div
            className="overflow-x-auto overscroll-contain"
            style={{ overscrollBehaviorX: 'contain', overscrollBehaviorY: 'auto' }}
          >
            <div className="min-w-[600px] md:min-w-0">
              <div className="grid grid-cols-6 gap-4 text-center pb-2.5 md:pb-3 border-b border-border">
                <div className="text-xs text-muted-foreground">PERIOD</div>
                <div className="text-xs text-muted-foreground">APY%</div>
                <div className="text-xs text-muted-foreground">CONSENSUS</div>
                <div className="text-xs text-muted-foreground">MISSED REWARDS</div>
                <div className="text-xs text-muted-foreground">EXECUTION</div>
                <div className="text-xs text-muted-foreground">TOTAL USD</div>
              </div>

              {snapshotLoading ? (
                <div className="animate-pulse space-y-3 py-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-10 bg-foreground/5 rounded" />
                  ))}
                </div>
              ) : (
                PERIODS.map(({ label, key }, idx) => (
                  <div
                    key={key}
                    className={`grid grid-cols-6 gap-4 text-center py-2.5 md:py-3 ${idx < PERIODS.length - 1 ? 'border-b border-border/50' : ''}`}
                  >
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-sm font-display text-white">{formatApy(getApy(key))}</div>
                    <div className="space-y-0.5">
                      <div className="text-base font-mono font-semibold">
                        {formatValue(getConsensusReward(key))} GNO
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-base font-mono font-semibold text-destructive">
                        {formatValue(getMissedReward(key))} GNO
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-base font-mono font-semibold">
                        {formatValue(getExecutionReward(key))} xDAI
                      </div>
                    </div>
                    <div className="text-sm font-mono">-</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
