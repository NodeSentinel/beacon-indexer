'use client';

import { HelpCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';

import type { ClusterFilter } from '@/types/cluster';
import type { MissedAttestation, Reward } from '@/types/validator';

import { ChartContainer } from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  UnderlineTabs,
  UnderlineTabsContent,
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from '@/components/underline-tabs';
import { useChainStats } from '@/hooks/use-chain-stats';
import { useMissedAttestations } from '@/hooks/use-missed-attestations';
import { useRewards } from '@/hooks/use-rewards';
import { bucketByTime, type AnalyticsTimeRange } from '@/lib/analytics-buckets';
import { formatNumber } from '@/lib/utils';

/** Format a token value to USD string */
function toUsd(tokenValue: number, price: number): string {
  const usd = tokenValue * price;
  if (usd === 0) return '$0.00';
  if (Math.abs(usd) < 0.01) return '<$0.01';
  return `$${formatNumber(usd)}`;
}

/** Format a small token value for display (up to 6 decimals) */
function fmtToken(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) < 0.000001) return '<0.000001';
  return formatNumber(value, 6);
}

interface AnalyticsContentProps {
  clusterFilter: ClusterFilter;
}

export default function AnalyticsContent({ clusterFilter }: AnalyticsContentProps) {
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>('1h');

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs md:text-sm text-primary uppercase tracking-wider shrink-0">
          Analytics
        </span>
        <div className="flex-1 h-px bg-primary/20" />
      </div>

      <UnderlineTabs defaultValue="rewards">
        <div className="flex items-center justify-between">
          <UnderlineTabsList className="border-b-0">
            <UnderlineTabsTrigger value="rewards">Rewards</UnderlineTabsTrigger>
            <UnderlineTabsTrigger value="missed-attestations">Miss-Attest</UnderlineTabsTrigger>
          </UnderlineTabsList>
          <Select
            value={timeRange}
            onValueChange={(value) => setTimeRange(value as AnalyticsTimeRange)}
          >
            <SelectTrigger className="w-auto h-7 border-0 bg-transparent text-xs text-muted-foreground gap-1 px-2 hover:text-foreground transition-colors">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="1h" className="text-xs">
                Last 1h
              </SelectItem>
              <SelectItem value="24h" className="text-xs">
                Last 24h
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <UnderlineTabsContent value="missed-attestations" className="mt-4">
          <MissedAttestationsTab clusterFilter={clusterFilter} timeRange={timeRange} />
        </UnderlineTabsContent>

        <UnderlineTabsContent value="rewards" className="mt-4">
          <RewardsTab clusterFilter={clusterFilter} timeRange={timeRange} />
        </UnderlineTabsContent>
      </UnderlineTabs>
    </div>
  );
}

// --- Missed Attestations Tab ---

function MissedAttestationsTab({
  clusterFilter,
  timeRange,
}: {
  clusterFilter: ClusterFilter;
  timeRange: AnalyticsTimeRange;
}) {
  const { data: missedData, isLoading } = useMissedAttestations(clusterFilter, null, timeRange);

  const chartData = useMemo(
    () =>
      bucketByTime(
        missedData ?? [],
        timeRange,
        (item) => new Date(item.timestamp).getTime(),
        (acc: { count: number; maxValidators: number } | undefined, item: MissedAttestation) => ({
          count: (acc?.count ?? 0) + item.count,
          maxValidators: Math.max(acc?.maxValidators ?? 0, item.validatorCount),
        }),
        (acc, time) => ({
          time,
          missedValue: acc?.count ?? 0,
          slot: acc?.count ?? 0,
          validators: acc?.maxValidators ?? 0,
        }),
      ),
    [missedData, timeRange],
  );

  const missedStats = useMemo(() => {
    const totalMissed = chartData.reduce((sum, item) => sum + item.slot, 0);
    const maxValidators =
      chartData.length > 0 ? Math.max(...chartData.map((item) => item.validators)) : 0;
    return { totalMissed, maxValidators };
  }, [chartData]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:gap-4 pb-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">TOTAL MISSED</p>
            <div className="h-7 w-16 bg-foreground/5 rounded animate-pulse" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">VALIDATORS AFFECTED</p>
            <div className="h-7 w-16 bg-foreground/5 rounded animate-pulse" />
          </div>
        </div>
        <div className="h-[250px] md:h-[300px] w-full bg-foreground/5 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:gap-4 pb-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">TOTAL MISSED</p>
          <span className="text-xl md:text-2xl font-normal text-destructive">
            {missedStats.totalMissed}
          </span>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">VALIDATORS AFFECTED</p>
          <span className="text-xl md:text-2xl font-normal text-warning">
            {missedStats.maxValidators}
          </span>
        </div>
      </div>

      <ChartContainer
        config={{
          missedValue: {
            label: 'Missed',
            color: '#fbbf24',
          },
        }}
        className="h-[250px] md:h-[300px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="time"
              stroke="#888888"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#888888' }}
            />
            <YAxis
              stroke="#888888"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#888888' }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const data = payload[0].payload;
                return (
                  <div className="rounded-lg border bg-background p-3 shadow-md">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-xs text-muted-foreground">Slots:</span>
                        <span className="text-sm font-normal">{data.slot}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-xs text-muted-foreground">Validators:</span>
                        <span className="text-sm font-normal">{data.validators}</span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="missedValue" fill="#fbbf24" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}

// --- Rewards Tab ---

type RewardBucket = {
  head: number;
  target: number;
  source: number;
  sync: number;
  missed: number;
  blockConsensus: number;
  blockExecution: number;
};

function RewardsTab({
  clusterFilter,
  timeRange,
}: {
  clusterFilter: ClusterFilter;
  timeRange: AnalyticsTimeRange;
}) {
  const { data: chainStats } = useChainStats();
  const { data: rewardsResponse, isLoading } = useRewards(clusterFilter, null, timeRange);

  const tokenPrice = rewardsResponse?.tokenPrice ?? chainStats?.tokenPrice ?? 0;

  const rewardsChartData = useMemo(
    () =>
      bucketByTime(
        rewardsResponse?.items ?? [],
        timeRange,
        (item) => new Date(item.timestamp).getTime(),
        (acc: RewardBucket | undefined, item: Reward) => ({
          head: (acc?.head ?? 0) + parseFloat(item.head),
          target: (acc?.target ?? 0) + parseFloat(item.target),
          source: (acc?.source ?? 0) + parseFloat(item.source),
          sync: (acc?.sync ?? 0) + parseFloat(item.sync),
          missed: (acc?.missed ?? 0) + parseFloat(item.missed),
          blockConsensus: (acc?.blockConsensus ?? 0) + parseFloat(item.blockConsensus),
          blockExecution: (acc?.blockExecution ?? 0) + parseFloat(item.blockExecution),
        }),
        (acc, time) => {
          const head = acc?.head ?? 0;
          const target = acc?.target ?? 0;
          const source = acc?.source ?? 0;
          const sync = acc?.sync ?? 0;
          const missed = acc?.missed ?? 0;
          const blockConsensus = acc?.blockConsensus ?? 0;
          const blockExecution = acc?.blockExecution ?? 0;
          const clTotal = (head + target + source + sync + blockConsensus - missed) * tokenPrice;
          const elTotal = blockExecution;
          return {
            time,
            head,
            target,
            source,
            sync,
            missed,
            blockConsensus,
            blockExecution,
            totalUsd: clTotal + elTotal,
          };
        },
      ),
    [rewardsResponse, timeRange, tokenPrice],
  );

  const rewardsStats = useMemo(() => {
    return rewardsChartData.reduce(
      (acc, item) => ({
        source: acc.source + item.source,
        target: acc.target + item.target,
        head: acc.head + item.head,
        sync: acc.sync + item.sync,
        missed: acc.missed + item.missed,
        blockConsensus: acc.blockConsensus + item.blockConsensus,
        blockExecution: acc.blockExecution + item.blockExecution,
      }),
      {
        source: 0,
        target: 0,
        head: 0,
        sync: 0,
        missed: 0,
        blockConsensus: 0,
        blockExecution: 0,
      },
    );
  }, [rewardsChartData]);

  const rewardsChartUsd = useMemo(
    () =>
      rewardsChartData.map((d) => ({
        time: d.time,
        head: d.head * tokenPrice,
        target: d.target * tokenPrice,
        source: d.source * tokenPrice,
        sync: d.sync * tokenPrice,
        blockConsensus: d.blockConsensus * tokenPrice,
        blockExecution: d.blockExecution,
        missed: -d.missed * tokenPrice,
        _raw: d,
      })),
    [rewardsChartData, tokenPrice],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 pb-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i}>
              <div className="h-3 w-12 bg-foreground/5 rounded animate-pulse mb-2" />
              <div className="h-5 w-20 bg-foreground/5 rounded animate-pulse mb-1" />
              <div className="h-3 w-14 bg-foreground/5 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="h-[250px] md:h-[300px] w-full bg-foreground/5 rounded animate-pulse" />
      </div>
    );
  }

  if (rewardsChartData.every((d) => d.totalUsd === 0)) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 pb-4">
        <RewardHeader
          label="SOURCE"
          help="Reward for correctly identifying the justified checkpoint. This is the largest component of attestation rewards."
          value={rewardsStats.source}
          token="GNO"
          color="#3b82f6"
          tokenPrice={tokenPrice}
        />
        <RewardHeader
          label="TARGET"
          help="Reward for correctly voting on the epoch checkpoint (target). Validators earn this by agreeing on the correct target block."
          value={rewardsStats.target}
          token="GNO"
          color="#10b981"
          tokenPrice={tokenPrice}
        />
        <RewardHeader
          label="HEAD"
          help="Reward for correctly voting on the most recent block (head of the chain). A smaller component of attestation rewards."
          value={rewardsStats.head}
          token="GNO"
          color="#8b5cf6"
          tokenPrice={tokenPrice}
        />
        <RewardHeader
          label="MISSED"
          help="Penalties incurred when your validator fails to attest or attests incorrectly. Small amounts are normal; large values may indicate downtime."
          value={rewardsStats.missed}
          token="GNO"
          color="hsl(var(--destructive))"
          tokenPrice={tokenPrice}
          isDestructive
        />
        <RewardHeader
          label="SYNC"
          help="Reward for participating in a sync committee. Only ~512 validators are randomly selected every ~27 hours, so this may be zero most of the time."
          value={rewardsStats.sync}
          token="GNO"
          color="#fbbf24"
          tokenPrice={tokenPrice}
        />
        <RewardHeader
          label="BLOCK (CL)"
          help="Consensus layer reward earned when your validator is randomly selected to propose a block. Includes attestation packing and sync aggregate rewards."
          value={rewardsStats.blockConsensus}
          token="GNO"
          color="#f97316"
          tokenPrice={tokenPrice}
        />
        <RewardHeader
          label="BLOCK (EL)"
          help="Execution layer reward (tips) earned when your validator proposes a block. Paid in the native token (xDAI on Gnosis, ETH on Ethereum)."
          value={rewardsStats.blockExecution}
          token="xDAI"
          color="#06b6d4"
          tokenPrice={1}
        />
      </div>

      <ChartContainer
        config={{
          source: { label: 'Source', color: '#3b82f6' },
          target: { label: 'Target', color: '#10b981' },
          head: { label: 'Head', color: '#8b5cf6' },
          sync: { label: 'Sync Committee', color: '#fbbf24' },
          blockConsensus: { label: 'Block (CL)', color: '#f97316' },
          blockExecution: { label: 'Block (EL)', color: '#06b6d4' },
          missed: { label: 'Missed', color: '#ef4444' },
        }}
        className="h-[250px] md:h-[300px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rewardsChartUsd} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="time"
              stroke="#888888"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#888888' }}
            />
            <YAxis
              stroke="#888888"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#888888' }}
              tickFormatter={(v) => `$${v.toFixed(2)}`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const raw = payload[0].payload._raw;
                return (
                  <div className="rounded-lg border bg-background p-3 shadow-md">
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">Source:</span>
                        <span className="font-normal" style={{ color: '#3b82f6' }}>
                          {fmtToken(raw.source)} GNO{' '}
                          <span className="text-muted-foreground">
                            ({toUsd(raw.source, tokenPrice)})
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">Target:</span>
                        <span className="font-normal" style={{ color: '#10b981' }}>
                          {fmtToken(raw.target)} GNO{' '}
                          <span className="text-muted-foreground">
                            ({toUsd(raw.target, tokenPrice)})
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">Head:</span>
                        <span className="font-normal" style={{ color: '#8b5cf6' }}>
                          {fmtToken(raw.head)} GNO{' '}
                          <span className="text-muted-foreground">
                            ({toUsd(raw.head, tokenPrice)})
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">Missed:</span>
                        <span className="font-normal text-destructive">
                          {fmtToken(raw.missed)} GNO{' '}
                          <span className="text-muted-foreground">
                            ({toUsd(raw.missed, tokenPrice)})
                          </span>
                        </span>
                      </div>
                      {raw.sync > 0 && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-muted-foreground">Sync Committee:</span>
                          <span className="font-normal text-warning">
                            {fmtToken(raw.sync)} GNO{' '}
                            <span className="text-muted-foreground">
                              ({toUsd(raw.sync, tokenPrice)})
                            </span>
                          </span>
                        </div>
                      )}
                      {raw.blockConsensus > 0 && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-muted-foreground">Block (CL):</span>
                          <span className="font-normal" style={{ color: '#f97316' }}>
                            {fmtToken(raw.blockConsensus)} GNO{' '}
                            <span className="text-muted-foreground">
                              ({toUsd(raw.blockConsensus, tokenPrice)})
                            </span>
                          </span>
                        </div>
                      )}
                      {raw.blockExecution > 0 && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-muted-foreground">Block (EL):</span>
                          <span className="font-normal" style={{ color: '#06b6d4' }}>
                            {fmtToken(raw.blockExecution)} xDAI{' '}
                            <span className="text-muted-foreground">
                              ({toUsd(raw.blockExecution, 1)})
                            </span>
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-4 pt-1 border-t">
                        <span className="text-muted-foreground">Total:</span>
                        <span className="font-normal">{toUsd(raw.totalUsd, 1)}</span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="source" stackId="rewards" fill="#3b82f6" radius={[0, 0, 0, 0]} />
            <Bar dataKey="target" stackId="rewards" fill="#10b981" radius={[0, 0, 0, 0]} />
            <Bar dataKey="head" stackId="rewards" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
            <Bar dataKey="sync" stackId="rewards" fill="#fbbf24" radius={[0, 0, 0, 0]} />
            <Bar dataKey="blockConsensus" stackId="rewards" fill="#f97316" radius={[0, 0, 0, 0]} />
            <Bar dataKey="blockExecution" stackId="rewards" fill="#06b6d4" radius={[0, 0, 0, 0]} />
            <Bar dataKey="missed" stackId="rewards" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}

// --- Shared Components ---

function RewardHeader({
  label,
  help,
  value,
  token,
  color,
  tokenPrice: price,
  isDestructive,
}: {
  label: string;
  help: string;
  value: number;
  token: string;
  color: string;
  tokenPrice: number;
  isDestructive?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <p className="text-[10px] md:text-[11px] text-muted-foreground">{label}</p>
        <UiTooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="size-3 text-muted-foreground/60 cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-[220px]">{help}</TooltipContent>
        </UiTooltip>
      </div>
      <span
        className={`text-base md:text-lg font-normal ${isDestructive ? 'text-destructive' : ''}`}
        style={isDestructive ? undefined : { color }}
      >
        {fmtToken(value)} {token}
      </span>
      <span className="block text-[10px] md:text-xs text-muted-foreground">
        {toUsd(value, price)}
      </span>
    </div>
  );
}
