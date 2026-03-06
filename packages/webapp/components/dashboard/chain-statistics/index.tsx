'use client';

import { Users, Coins, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

import { env } from '@/env';
import { useChainStats } from '@/hooks/use-chain-stats';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { formatNumber, getTokenSymbol } from '@/lib/utils';

export default function ChainStatistics() {
  const { data: chainStats, isLoading } = useChainStats();
  const { data: syncStatus } = useSyncStatus();
  const tokenSymbol = getTokenSymbol(env.NEXT_PUBLIC_CHAIN);

  const tokenPrice = chainStats?.tokenPrice ?? 0;
  const totalStaked = chainStats ? parseFloat(chainStats.totalStaked) : 0;
  const activeValidators = chainStats?.totalActiveValidators ?? 0;
  const joiningValidators = chainStats?.validatorsEntering ?? 0;
  const leavingValidators = chainStats?.validatorsExiting ?? 0;

  const activeStaked = activeValidators * 32;
  const joiningStaked = joiningValidators * 32;
  const leavingStaked = leavingValidators * 32;

  const totalStakedUsd = formatNumber(totalStaked * tokenPrice);
  const activeStakedUsd = formatNumber(activeStaked * tokenPrice);
  const joiningStakedUsd = formatNumber(joiningStaked * tokenPrice);
  const leavingStakedUsd = formatNumber(leavingStaked * tokenPrice);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <h2 className="text-[10px] md:text-xs font-display text-muted-foreground uppercase tracking-wider">
          Chain Statistics
        </h2>
        <div className="bg-muted/30 border border-border/50 rounded-lg p-2.5 md:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-5">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4"
              >
                <div className="animate-pulse space-y-2">
                  <div className="h-4 bg-foreground/5 rounded w-1/3" />
                  <div className="h-8 bg-foreground/5 rounded w-2/3" />
                  <div className="h-3 bg-foreground/5 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] md:text-xs font-display text-muted-foreground uppercase tracking-wider">
          Chain Statistics
        </h2>
        {syncStatus && (
          <div className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${syncStatus.isSynced ? 'bg-chart-2' : 'bg-warning animate-pulse'}`}
            />
            <span className="text-[10px] md:text-xs font-mono text-muted-foreground">
              {formatNumber(syncStatus.currentSlot ?? 0)}
              {' / '}
              {formatNumber(syncStatus.processingSlot ?? 0)}
            </span>
          </div>
        )}
      </div>
      <div className="bg-muted/30 border border-border/50 rounded-lg p-2.5 md:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-5">
          {/* Active Validators Card */}
          <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4">
            <div className="flex items-start gap-2 md:gap-3">
              <div className="p-1.5 md:p-2 bg-chart-2/10 rounded-lg">
                <Users className="w-3.5 h-3.5 md:w-4 md:h-4 text-chart-2" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide mb-0.5 md:mb-1">
                  Active
                </p>
                <p className="text-xl md:text-2xl font-display font-bold text-foreground truncate">
                  {formatNumber(activeValidators)}
                </p>
                <p className="text-[10px] md:text-xs text-muted-foreground/80 mt-0.5">
                  ${activeStakedUsd}
                </p>
              </div>
            </div>
          </div>

          {/* Staked GNO Card */}
          <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4">
            <div className="flex items-start gap-2 md:gap-3">
              <div className="p-1.5 md:p-2 bg-primary/10 rounded-lg">
                <Coins className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide mb-0.5 md:mb-1">
                  Staked
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl md:text-2xl font-display font-bold text-foreground">
                    {(totalStaked / 1000).toFixed(0)}k
                  </span>
                  <span className="text-xs md:text-sm text-muted-foreground font-medium">
                    {tokenSymbol}
                  </span>
                </div>
                <p className="text-[10px] md:text-xs text-muted-foreground/80 mt-0.5">
                  ${totalStakedUsd}
                </p>
              </div>
            </div>
          </div>

          {/* Joining/Leaving Card */}
          <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4 sm:col-span-2 lg:col-span-1">
            <div className="grid grid-cols-2 gap-3 md:gap-4">
              <div className="flex flex-col gap-1.5 md:gap-2">
                <div className="flex items-center gap-1.5 md:gap-2">
                  <div className="p-1 md:p-1.5 bg-chart-2/10 rounded">
                    <ArrowUpCircle className="w-3 h-3 md:w-3.5 md:h-3.5 text-chart-2" />
                  </div>
                  <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide">
                    Joining
                  </span>
                </div>
                <div>
                  <div className="flex items-baseline gap-1">
                    <p className="text-lg md:text-2xl font-display font-bold text-white">
                      {formatNumber(joiningValidators)}
                    </p>
                  </div>
                  <p className="text-[10px] md:text-xs text-muted-foreground/80 mt-0.5">
                    ${joiningStakedUsd}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 md:gap-2">
                <div className="flex items-center gap-1.5 md:gap-2">
                  <div className="p-1 md:p-1.5 bg-warning/10 rounded">
                    <ArrowDownCircle className="w-3 h-3 md:w-3.5 md:h-3.5 text-warning" />
                  </div>
                  <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide">
                    Leaving
                  </span>
                </div>
                <div>
                  <div className="flex items-baseline gap-1">
                    <p className="text-lg md:text-2xl font-display font-bold text-white">
                      {formatNumber(leavingValidators)}
                    </p>
                  </div>
                  <p className="text-[10px] md:text-xs text-muted-foreground/80 mt-0.5">
                    ${leavingStakedUsd}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
