'use client';

import { Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Cluster } from '@/types/cluster';
import type { Stats } from '@/types/validator';

interface ClusterOverviewContentProps {
  cluster: Cluster;
  stats: Stats;
  gnoPrice: number;
  onManage?: () => void;
  showManageButton?: boolean;
}

export default function ClusterOverviewContent({
  cluster,
  stats,
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

  const performance24h = 82.0;
  const performance7d = 91.0;
  const performance30d = 98.0;

  return (
    <div className="border-t border-border/50 p-4 md:p-6">
      <div className="space-y-4 md:space-y-6">
        {/* Unified header: Cluster name, validators status, and manage button */}
        <div className="flex items-center justify-between gap-3 pb-2.5 md:pb-3 border-b border-border/50">
          <div className="flex items-center gap-3 md:gap-4 flex-wrap min-w-0">
            {/* Cluster name */}
            <h2 className="text-lg md:text-xl font-semibold truncate">{cluster.name}</h2>

            {/* Validator count badge */}
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 font-semibold text-xs md:text-sm shrink-0">
              {totalValidators} VALIDATOR{totalValidators !== 1 ? 'S' : ''}
            </span>

            {/* Status badges */}
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

          {/* Manage button */}
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">1H</p>
              <span className={`text-xl md:text-2xl font-display text-white`}>
                {cluster.performance.toFixed(2)}%
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">24H</p>
              <span className={`text-xl md:text-2xl font-display text-white`}>
                {performance24h.toFixed(2)}%
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">7D</p>
              <span className={`text-xl md:text-2xl font-display text-white`}>
                {performance7d.toFixed(2)}%
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 md:mb-1">30D</p>
              <span className={`text-xl md:text-2xl font-display text-white`}>
                {performance30d.toFixed(2)}%
              </span>
            </div>
          </div>
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

              {/* Daily */}
              <div className="grid grid-cols-6 gap-4 text-center py-2.5 md:py-3 border-b border-border/50">
                <div className="text-sm font-medium">Day</div>
                <div className="text-sm font-display text-white">{stats.apyDay.toFixed(2)}%</div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.gnoDay.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${(stats.gnoDay * gnoPrice).toFixed(2)}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold text-destructive">
                    {stats.missedDay.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">-</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.xdaiDay.toFixed(2)} xDAI
                  </div>
                  <div className="text-xs text-muted-foreground">${stats.xdaiDay.toFixed(2)}</div>
                </div>
                <div className="text-sm font-mono">${stats.totalDay.toFixed(2)}</div>
              </div>

              {/* Weekly */}
              <div className="grid grid-cols-6 gap-4 text-center py-2.5 md:py-3 border-b border-border/50">
                <div className="text-sm font-medium">Week</div>
                <div className="text-sm font-display text-white">{stats.apyWeek.toFixed(2)}%</div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.gnoWeek.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${(stats.gnoWeek * gnoPrice).toFixed(2)}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold text-destructive">
                    {stats.missedWeek.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">-</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.xdaiWeek.toFixed(2)} xDAI
                  </div>
                  <div className="text-xs text-muted-foreground">${stats.xdaiWeek.toFixed(2)}</div>
                </div>
                <div className="text-sm font-mono">${stats.totalWeek.toFixed(2)}</div>
              </div>

              {/* Monthly */}
              <div className="grid grid-cols-6 gap-4 text-center py-2.5 md:py-3">
                <div className="text-sm font-medium">Month</div>
                <div className="text-sm font-display text-white">{stats.apyMonth.toFixed(2)}%</div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.gnoMonth.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${(stats.gnoMonth * gnoPrice).toFixed(2)}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold text-destructive">
                    {stats.missedMonth.toFixed(2)} GNO
                  </div>
                  <div className="text-xs text-muted-foreground">-</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-mono font-semibold">
                    {stats.xdaiMonth.toFixed(2)} xDAI
                  </div>
                  <div className="text-xs text-muted-foreground">${stats.xdaiMonth.toFixed(2)}</div>
                </div>
                <div className="text-sm font-mono">${stats.totalMonth.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
