'use client';

import type { LucideIcon } from 'lucide-react';
import { Users, Coins, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

import { env } from '@/env';
import { useChainStats } from '@/hooks/use-chain-stats';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { formatNumber, getTokenSymbol } from '@/lib/utils';

interface StatCardProps {
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  suffix?: string;
  subValue: string;
}

function StatCard({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  suffix,
  subValue,
}: StatCardProps) {
  return (
    <div className="border border-border/60 rounded-lg p-2.5 md:p-3.5">
      <div className="flex items-start gap-2 md:gap-3">
        <div className={`p-1.5 md:p-2 ${iconBg} rounded-lg`}>
          <Icon className={`w-3.5 h-3.5 md:w-4 md:h-4 ${iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide mb-0.5 md:mb-1">
            {label}
          </p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl md:text-2xl font-display font-bold text-foreground truncate">
              {value}
            </span>
            {suffix && (
              <span className="text-xs md:text-sm text-muted-foreground font-medium">{suffix}</span>
            )}
          </div>
          <p className="text-[10px] md:text-xs text-muted-foreground/80 mt-0.5">{subValue}</p>
        </div>
      </div>
    </div>
  );
}

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

  const totalStakedUsd = formatNumber(totalStaked * tokenPrice, 0);
  const activeStakedUsd = formatNumber(activeStaked * tokenPrice, 0);
  const joiningStakedUsd = formatNumber(joiningStaked * tokenPrice, 0);
  const leavingStakedUsd = formatNumber(leavingStaked * tokenPrice, 0);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <h2 className="text-[10px] md:text-xs font-display text-muted-foreground uppercase tracking-wider">
          Chain Statistics
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="border border-border/60 rounded-lg p-2.5 md:p-3.5">
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-foreground/5 rounded w-1/3" />
                <div className="h-8 bg-foreground/5 rounded w-2/3" />
                <div className="h-3 bg-foreground/5 rounded w-1/2" />
              </div>
            </div>
          ))}
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        <StatCard
          icon={Users}
          iconColor="text-chart-2"
          iconBg="bg-chart-2/10"
          label="Active"
          value={formatNumber(activeValidators)}
          subValue={`$${activeStakedUsd}`}
        />
        <StatCard
          icon={Coins}
          iconColor="text-primary"
          iconBg="bg-primary/10"
          label="Staked"
          value={`${(totalStaked / 1000).toFixed(0)}k`}
          suffix={tokenSymbol}
          subValue={`$${totalStakedUsd}`}
        />
        <StatCard
          icon={ArrowUpCircle}
          iconColor="text-chart-2"
          iconBg="bg-chart-2/10"
          label="Joining"
          value={formatNumber(joiningValidators)}
          subValue={`$${joiningStakedUsd}`}
        />
        <StatCard
          icon={ArrowDownCircle}
          iconColor="text-warning"
          iconBg="bg-warning/10"
          label="Leaving"
          value={formatNumber(leavingValidators)}
          subValue={`$${leavingStakedUsd}`}
        />
      </div>
    </div>
  );
}
