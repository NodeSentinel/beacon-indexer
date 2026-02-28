'use client';

import { Users, Coins, ArrowUpCircle, ArrowDownCircle, GitMerge, AlertCircle } from 'lucide-react';

import { env } from '@/env';
import { useChainStats } from '@/hooks/use-chain-stats';
import { formatNumber, getTokenSymbol } from '@/lib/utils';

function formatStaked(value: string): string {
  const num = parseFloat(value);
  if (num >= 1_000_000) return `${formatNumber(num / 1_000_000)}M`;
  if (num >= 1_000) return `${formatNumber(num / 1_000)}k`;
  return formatNumber(num);
}

function StatSkeleton() {
  return (
    <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4">
      <div className="animate-pulse space-y-2">
        <div className="h-3 bg-foreground/5 rounded w-1/3" />
        <div className="h-7 bg-foreground/5 rounded w-2/3" />
        <div className="h-3 bg-foreground/5 rounded w-1/2" />
      </div>
    </div>
  );
}

export default function ChainStatistics() {
  const { data, isLoading, isError, refetch } = useChainStats();
  const tokenSymbol = getTokenSymbol(env.NEXT_PUBLIC_CHAIN);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <h2 className="text-[10px] md:text-xs font-display text-muted-foreground uppercase tracking-wider">
          Chain Statistics
        </h2>
        <div className="bg-muted/30 border border-border/50 rounded-lg p-2.5 md:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-5">
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-2">
        <h2 className="text-[10px] md:text-xs font-display text-muted-foreground uppercase tracking-wider">
          Chain Statistics
        </h2>
        <div className="bg-muted/30 border border-border/50 rounded-lg p-2.5 md:p-5">
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Failed to load chain statistics.</span>
            <button
              onClick={() => refetch()}
              className="text-sm text-primary underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-[10px] md:text-xs font-display text-muted-foreground uppercase tracking-wider">
        Chain Statistics
      </h2>
      <div className="bg-muted/30 border border-border/50 rounded-lg p-2.5 md:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-5">
          {/* Active Validators Card */}
          <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4">
            <div className="flex items-start gap-2 md:gap-3">
              <div className="p-1.5 md:p-2 bg-chart-2/10 rounded-lg">
                <Users className="w-3.5 h-3.5 md:w-4 md:h-4 text-chart-2" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide mb-0.5 md:mb-1">
                  Active Validators
                </p>
                <p className="text-xl md:text-2xl font-display font-bold text-foreground truncate">
                  {formatNumber(data.totalActiveValidators)}
                </p>
                <p className="text-[10px] md:text-xs text-muted-foreground/80 mt-0.5">
                  Epoch {formatNumber(data.epoch)}
                </p>
              </div>
            </div>
          </div>

          {/* Staked Card */}
          <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4">
            <div className="flex items-start gap-2 md:gap-3">
              <div className="p-1.5 md:p-2 bg-primary/10 rounded-lg">
                <Coins className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide mb-0.5 md:mb-1">
                  Total Staked
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl md:text-2xl font-display font-bold text-foreground">
                    {formatStaked(data.totalStaked)}
                  </span>
                  <span className="text-xs md:text-sm text-muted-foreground font-medium">
                    {tokenSymbol}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Joining/Leaving Card */}
          <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4">
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
                <p className="text-lg md:text-2xl font-display font-bold text-foreground">
                  {formatNumber(data.validatorsEntering)}
                </p>
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
                <p className="text-lg md:text-2xl font-display font-bold text-foreground">
                  {formatNumber(data.validatorsExiting)}
                </p>
              </div>
            </div>
          </div>

          {/* Consolidating Card */}
          <div className="bg-background border border-border/60 rounded-lg p-2.5 md:p-4">
            <div className="flex items-start gap-2 md:gap-3">
              <div className="p-1.5 md:p-2 bg-chart-4/10 rounded-lg">
                <GitMerge className="w-3.5 h-3.5 md:w-4 md:h-4 text-chart-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide mb-0.5 md:mb-1">
                  Consolidating
                </p>
                <p className="text-xl md:text-2xl font-display font-bold text-foreground truncate">
                  {formatNumber(data.validatorsConsolidating)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
