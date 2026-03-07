'use client';

import { Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ClusterSnapshot } from '@/hooks/use-cluster-snapshot';
import { formatNumber } from '@/lib/utils';
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

function formatUsd(value: string | null, price: number): string {
  if (value === null) return '-';
  const num = parseFloat(value);
  if (isNaN(num)) return '-';
  return `$${formatNumber(num * price)}`;
}

function formatTotalUsd(
  consensusReward: string | null,
  tokenPrice: number,
  executionReward: string | null,
): string {
  const consensus = consensusReward !== null ? parseFloat(consensusReward) : 0;
  const execution = executionReward !== null ? parseFloat(executionReward) : 0;
  if (isNaN(consensus) && isNaN(execution)) return '-';
  const total =
    (isNaN(consensus) ? 0 : consensus) * tokenPrice + (isNaN(execution) ? 0 : execution);
  return `$${formatNumber(total)}`;
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

  const balanceUsd = formatNumber(cluster.totalBalance * gnoPrice);
  const effectiveBalanceUsd = formatNumber(cluster.totalEffectiveBalance * gnoPrice, 0);
  const claimableUsd = formatNumber(cluster.claimableRewards * gnoPrice);

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

  const getExecutionReward = (key: PeriodKey): { wei: string; token: string } | null => {
    if (!snapshot) return null;
    const map: Record<PeriodKey, { wei: string; token: string } | null> = {
      '1h': snapshot.executionReward1h,
      '1d': snapshot.executionReward1d,
      '1w': snapshot.executionReward1w,
      '1m': snapshot.executionReward1m,
    };
    return map[key];
  };

  return (
    <div>
      <div className="space-y-4 md:space-y-5">
        {/* Validators status and manage button */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 md:gap-4 flex-wrap min-w-0">
            <span className="text-sm md:text-base font-semibold shrink-0 text-primary">
              {totalValidators} Validator{totalValidators !== 1 ? 's' : ''}
            </span>

            {getStatusDisplay().length > 0 && (
              <>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-2.5 md:gap-3 flex-wrap">
                  {getStatusDisplay().map((status) => (
                    <div key={status.label} className="inline-flex items-center gap-1.5 shrink-0">
                      <span className="text-sm">{status.emoji}</span>
                      <span
                        className={`text-sm md:text-base font-bold font-display ${status.color}`}
                      >
                        {status.count}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize hidden sm:inline">
                        {status.label}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {showManageButton && onManage && (
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent shrink-0"
              onClick={onManage}
            >
              <Settings className="size-4 md:mr-2" />
              <span className="hidden md:inline">Edit Cluster</span>
            </Button>
          )}
        </div>

        {/* Balances */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs md:text-sm text-primary uppercase tracking-wider shrink-0">
              Balances
            </span>
            <div className="flex-1 h-px bg-primary/20" />
          </div>
          <div className="grid grid-cols-3 gap-3 md:gap-4 text-center">
            <div>
              <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5">Balance</p>
              <p className="text-sm md:text-lg font-display font-semibold">
                {cluster.totalBalance.toFixed(2)} GNO
              </p>
              <p className="text-[10px] text-muted-foreground">${balanceUsd}</p>
            </div>
            <div>
              <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5">Effective</p>
              <p className="text-sm md:text-lg font-display font-semibold">
                {cluster.totalEffectiveBalance.toFixed(0)} GNO
              </p>
              <p className="text-[10px] text-muted-foreground">${effectiveBalanceUsd}</p>
            </div>
            <div>
              <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5">Claimable</p>
              <p className="text-sm md:text-lg font-display font-semibold">
                {cluster.claimableRewards.toFixed(2)} GNO
              </p>
              <p className="text-[10px] text-muted-foreground">${claimableUsd}</p>
            </div>
          </div>
        </div>

        {/* Performance */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs md:text-sm text-primary uppercase tracking-wider shrink-0">
              Performance
            </span>
            <div className="flex-1 h-px bg-primary/20" />
          </div>
          {snapshotLoading ? (
            <div className="animate-pulse h-10 bg-foreground/5 rounded" />
          ) : (
            <div className="grid grid-cols-4 gap-3 md:gap-4 text-center">
              {PERIODS.map(({ label, key }) => (
                <div key={key}>
                  <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5">{label}</p>
                  <p className="text-sm md:text-lg font-display font-semibold">
                    {formatPercent(getPerformance(key))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rewards - Cards on mobile, table on desktop */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs md:text-sm text-primary uppercase tracking-wider shrink-0">
              Rewards
            </span>
            <div className="flex-1 h-px bg-primary/20" />
          </div>

          {snapshotLoading ? (
            <div className="animate-pulse space-y-3 py-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 bg-foreground/5 rounded" />
              ))}
            </div>
          ) : (
            <>
              {/* Mobile: stacked periods with dividers */}
              <div className="md:hidden divide-y divide-border/40">
                {PERIODS.map(({ label, key }) => (
                  <div key={key} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold">{label}</span>
                      <span className="text-sm font-display">{formatApy(getApy(key))}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Consensus</p>
                        <p className="text-sm font-mono font-semibold">
                          {formatValue(getConsensusReward(key))} GNO
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatUsd(getConsensusReward(key), gnoPrice)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Missed</p>
                        <p className="text-sm font-mono font-semibold text-destructive">
                          {formatValue(getMissedReward(key))} GNO
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatUsd(getMissedReward(key), gnoPrice)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Execution</p>
                        <p className="text-sm font-mono font-semibold">
                          {formatValue(getExecutionReward(key)?.token ?? null)} xDAI
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatUsd(getExecutionReward(key)?.token ?? null, 1)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Total USD</p>
                        <p className="text-sm font-mono font-semibold">
                          {formatTotalUsd(
                            getConsensusReward(key),
                            gnoPrice,
                            getExecutionReward(key)?.token ?? null,
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table layout */}
              <div className="hidden md:block">
                <div className="grid grid-cols-6 gap-4 text-center pb-3">
                  <div className="text-xs text-muted-foreground">PERIOD</div>
                  <div className="text-xs text-muted-foreground">APY%</div>
                  <div className="text-xs text-muted-foreground">CONSENSUS</div>
                  <div className="text-xs text-muted-foreground">MISSED REWARDS</div>
                  <div className="text-xs text-muted-foreground">EXECUTION</div>
                  <div className="text-xs text-muted-foreground">TOTAL USD</div>
                </div>
                {PERIODS.map(({ label, key }) => (
                  <div key={key} className="grid grid-cols-6 gap-4 text-center py-3">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-sm font-display text-white">{formatApy(getApy(key))}</div>
                    <div className="space-y-0.5">
                      <div className="text-base font-mono font-semibold">
                        {formatValue(getConsensusReward(key))} GNO
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatUsd(getConsensusReward(key), gnoPrice)}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-base font-mono font-semibold text-destructive">
                        {formatValue(getMissedReward(key))} GNO
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatUsd(getMissedReward(key), gnoPrice)}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-base font-mono font-semibold">
                        {formatValue(getExecutionReward(key)?.token ?? null)} xDAI
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatUsd(getExecutionReward(key)?.token ?? null, 1)}
                      </div>
                    </div>
                    <div className="text-sm font-mono">
                      {formatTotalUsd(
                        getConsensusReward(key),
                        gnoPrice,
                        getExecutionReward(key)?.token ?? null,
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
