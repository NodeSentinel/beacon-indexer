'use client';

import { Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useClusterSnapshot } from '@/hooks/use-cluster-snapshot';
import { useTokenPrice } from '@/hooks/use-token-price';
import { formatNumber } from '@/lib/utils';
import type { Cluster } from '@/types/cluster';

interface ClusterOverviewContentProps {
  cluster: Cluster;
  onManage?: () => void;
  showManageButton?: boolean;
}

const PERIODS = [
  { label: '1H', mobileLabel: '1 HOUR', key: '1h' },
  { label: '1D', mobileLabel: '1 DAY', key: '1d' },
  { label: '1W', mobileLabel: '1 WEEK', key: '1w' },
  { label: '1M', mobileLabel: '1 MONTH', key: '1m' },
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
  onManage,
  showManageButton = false,
}: ClusterOverviewContentProps) {
  const { data: snapshot, isLoading: snapshotLoading } = useClusterSnapshot(cluster.id);
  const { data: tokenPriceData } = useTokenPrice();
  const gnoPrice = tokenPriceData?.tokenPrice ?? 0;
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

  const totalValidators = cluster.validatorCount ?? cluster.validators.length;

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

  const getAvgDelay = (key: PeriodKey): number | null => {
    if (!snapshot) return null;
    const map: Record<PeriodKey, number | null> = {
      '1h': null,
      '1d': snapshot.avgAttestationDelay1d,
      '1w': snapshot.avgAttestationDelay1w,
      '1m': snapshot.avgAttestationDelay1m,
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
            <span className="text-xs md:text-sm font-semibold shrink-0 text-primary border border-primary/40 bg-primary/10 rounded px-2.5 py-0.5">
              {totalValidators} Validator{totalValidators !== 1 ? 's' : ''}
            </span>

            {getStatusDisplay().length > 0 && (
              <>
                <div className="flex items-center gap-2.5 md:gap-3 flex-wrap">
                  {getStatusDisplay().map((status) => (
                    <div key={status.label} className="inline-flex items-center gap-1.5 shrink-0">
                      <span className="text-sm">{status.emoji}</span>
                      <span
                        className={`text-sm md:text-base font-bold font-normal ${status.color}`}
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
          <div className="grid grid-cols-3 gap-3 md:gap-4 md:text-center">
            <div>
              <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5">Balance</p>
              <p className="text-sm md:text-lg font-normal font-semibold">
                {cluster.totalBalance.toFixed(2)} GNO
              </p>
              <p className="text-[10px] text-muted-foreground">${balanceUsd}</p>
            </div>
            <div>
              <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5">Effective</p>
              <p className="text-sm md:text-lg font-normal font-semibold">
                {cluster.totalEffectiveBalance.toFixed(0)} GNO
              </p>
              <p className="text-[10px] text-muted-foreground">${effectiveBalanceUsd}</p>
            </div>
            <div>
              <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5">Claimable</p>
              <p className="text-sm md:text-lg font-normal font-semibold">
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
            <>
              <div className="grid grid-cols-5 gap-3 md:gap-4 md:text-center">
                <div />
                {PERIODS.map(({ key, label }) => (
                  <div key={key}>
                    <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5">{label}</p>
                    <p className="text-sm md:text-lg font-normal font-semibold">
                      {formatPercent(getPerformance(key))}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-5 gap-3 md:gap-4 md:text-center mt-1.5">
                <div className="flex items-center">
                  <p className="text-[10px] md:text-xs">Avg Delay</p>
                </div>
                <div></div>
                {PERIODS.filter(({ key }) => key !== '1h').map(({ key }) => {
                  const delay = getAvgDelay(key);
                  return (
                    <div key={key}>
                      <p className="text-[10px] md:text-xs">
                        {delay !== null ? `${(delay + 1).toFixed(2)} slots` : '-'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
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
            <div className="animate-pulse space-y-2 py-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 bg-foreground/5 rounded" />
              ))}
            </div>
          ) : (
            <>
              {/* Mobile: stacked cards */}
              <div className="md:hidden space-y-2">
                {PERIODS.map(({ key, mobileLabel }) => (
                  <div key={key}>
                    <div className="flex items-center">
                      <span className="text-sm font-normal font-semibold">{mobileLabel}</span>
                    </div>

                    <div className="ml-1.5 mt-1.5 border-l border-border/40 pl-2.5 space-y-1 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">APY</span>
                        <span>{formatApy(getApy(key))}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Consensus</span>
                        <span>
                          {formatValue(getConsensusReward(key))} GNO
                          <span className="ml-1">
                            ({formatUsd(getConsensusReward(key), gnoPrice)})
                          </span>
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Missed</span>
                        <span className="text-destructive">
                          {formatValue(getMissedReward(key))} GNO
                          <span className="ml-1">
                            ({formatUsd(getMissedReward(key), gnoPrice)})
                          </span>
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Execution</span>
                        <span>
                          {formatValue(getExecutionReward(key)?.token ?? null)} xDAI
                          <span className="ml-1">
                            ({formatUsd(getExecutionReward(key)?.token ?? null, 1)})
                          </span>
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Total</span>
                        <span>
                          {formatTotalUsd(
                            getConsensusReward(key),
                            gnoPrice,
                            getExecutionReward(key)?.token ?? null,
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table layout */}
              <div className="hidden md:block">
                <div className="grid grid-cols-6 gap-4 text-center pb-3">
                  <div className="text-xs text-muted-foreground">PERIOD</div>
                  <div className="text-xs text-muted-foreground">APY</div>
                  <div className="text-xs text-muted-foreground">CONSENSUS</div>
                  <div className="text-xs text-muted-foreground">MISSED</div>
                  <div className="text-xs text-muted-foreground">EXECUTION</div>
                  <div className="text-xs text-muted-foreground">TOTAL</div>
                </div>
                {PERIODS.map(({ key, label }) => (
                  <div
                    key={key}
                    className="grid grid-cols-6 gap-4 text-center py-2 border-t border-border/30"
                  >
                    <div className="text-sm font-semibold">{label}</div>
                    <div className="text-sm font-normal">{formatApy(getApy(key))}</div>
                    <div>
                      <div className="text-sm font-mono">
                        {formatValue(getConsensusReward(key))} GNO
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatUsd(getConsensusReward(key), gnoPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-mono text-destructive">
                        {formatValue(getMissedReward(key))} GNO
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatUsd(getMissedReward(key), gnoPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-mono">
                        {formatValue(getExecutionReward(key)?.token ?? null)} xDAI
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatUsd(getExecutionReward(key)?.token ?? null, 1)}
                      </div>
                    </div>
                    <div className="text-sm font-mono font-semibold">
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
