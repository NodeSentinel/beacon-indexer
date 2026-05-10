'use client';

import { ArrowDownCircle, ArrowUpCircle, ChevronDown, ChevronUp, Coins, Users } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { env } from '@/env';
import { useChainStats } from '@/hooks/use-chain-stats';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { useTokenPrice } from '@/hooks/use-token-price';
import {
  formatNumber,
  formatSlotSyncStatus,
  getSlotDurationSeconds,
  getTokenSymbol,
} from '@/lib/utils';

interface StatCardProps {
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  suffix?: string;
  subValue: string;
}

/** Renders one chain statistic card. */
function StatCard({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  subValue,
  suffix,
  value,
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
            <span className="text-xl md:text-2xl font-normal font-bold text-foreground truncate">
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

/** Renders the chain statistics section with lazy-loaded expanded metrics. */
export default function ChainStatistics() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: chainStats, isLoading: isChainStatsLoading } = useChainStats(isExpanded);
  const { data: syncStatus } = useSyncStatus();
  const { data: tokenPriceData, isLoading: isTokenPriceLoading } = useTokenPrice();
  const tokenSymbol = getTokenSymbol(env.NEXT_PUBLIC_CHAIN);
  const slotDurationSeconds = getSlotDurationSeconds(env.NEXT_PUBLIC_CHAIN);

  const tokenPrice = tokenPriceData?.tokenPrice ?? 0;
  const tokenPriceLabel =
    tokenPrice > 0
      ? `${tokenSymbol} $${tokenPrice.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : null;
  const totalStaked = chainStats ? parseFloat(chainStats.totalStaked) : 0;
  const activeValidators = chainStats?.totalActiveValidators ?? 0;
  const joiningValidators = chainStats?.validatorsEntering ?? 0;
  const leavingValidators = chainStats?.validatorsExiting ?? 0;

  const enteringStaked = chainStats ? parseFloat(chainStats.enteringStaked) : 0;
  const activeStaked = activeValidators * 32;
  const leavingStaked = leavingValidators * 32;

  const totalStakedUsd = formatNumber(totalStaked * tokenPrice, 0);
  const activeStakedUsd = formatNumber(activeStaked * tokenPrice, 0);
  const enteringStakedUsd = formatNumber(enteringStaked * tokenPrice, 0);
  const leavingStakedUsd = formatNumber(leavingStaked * tokenPrice, 0);
  const lastIndexedSlot = syncStatus?.lastIndexedSlot ?? 0;

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className="space-y-2">
      <div className="flex w-full items-center gap-2 rounded-lg text-left md:gap-3">
        {tokenPriceLabel ? (
          <Badge
            variant="outline"
            className="h-5 shrink-0 select-text border-border/60 bg-transparent px-1.5 text-[10px] font-mono text-muted-foreground"
          >
            {tokenPriceLabel}
          </Badge>
        ) : (
          <span className="h-5 w-16 shrink-0 rounded border border-border/60 bg-transparent animate-pulse" />
        )}
        {syncStatus && (
          <Badge
            variant="outline"
            className="h-5 min-w-0 select-text border-transparent bg-transparent px-1.5 text-[10px] font-mono text-muted-foreground"
          >
            <div
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${syncStatus.isSynced ? 'bg-chart-2' : 'bg-warning animate-pulse'}`}
            />
            <span className="truncate">
              {formatSlotSyncStatus({
                currentSlot: syncStatus.currentSlot ?? 0,
                isSynced: syncStatus.isSynced,
                lastIndexedSlot,
                slotDurationSeconds,
              })}
            </span>
          </Badge>
        )}
        <CollapsibleTrigger asChild>
          <button type="button" className="ml-auto flex shrink-0 items-center gap-1 rounded-lg">
            <h2 className="text-[10px] font-normal text-muted-foreground md:text-xs">
              Chain stats
            </h2>
            {isExpanded ? (
              <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            )}
          </button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        {isChainStatsLoading || isTokenPriceLoading ? (
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
        ) : (
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
              suffix={
                enteringStaked > 0 ? `${formatNumber(enteringStaked)} ${tokenSymbol}` : undefined
              }
              subValue={`$${enteringStakedUsd}`}
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
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
