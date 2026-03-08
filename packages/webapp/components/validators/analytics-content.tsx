'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';

import { ChartContainer } from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  UnderlineTabs,
  UnderlineTabsContent,
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from '@/components/underline-tabs';
import { bucketByTime, type AnalyticsTimeRange } from '@/lib/analytics-buckets';
import { formatNumber } from '@/lib/utils';
import type { MissedAttestation, Reward } from '@/types/validator';

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
  data: MissedAttestation[];
  rewardsData: Reward[];
  timeRange: AnalyticsTimeRange;
  onTimeRangeChange: (range: AnalyticsTimeRange) => void;
  tokenPrice: number;
}

type RewardBucket = {
  head: number;
  target: number;
  source: number;
  syncCommittee: number;
  missed: number;
  blockConsensus: number;
  blockExecution: number;
};

export default function AnalyticsContent({
  data,
  rewardsData,
  timeRange,
  onTimeRangeChange,
  tokenPrice,
}: AnalyticsContentProps) {
  const chartData = useMemo(
    () =>
      bucketByTime(
        data,
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
    [data, timeRange],
  );

  const rewardsChartData = useMemo(
    () =>
      bucketByTime(
        rewardsData,
        timeRange,
        (item) => new Date(item.timestamp).getTime(),
        (acc: RewardBucket | undefined, item: Reward) => ({
          head: (acc?.head ?? 0) + parseFloat(item.head),
          target: (acc?.target ?? 0) + parseFloat(item.target),
          source: (acc?.source ?? 0) + parseFloat(item.source),
          syncCommittee: (acc?.syncCommittee ?? 0) + parseFloat(item.syncCommittee),
          missed: (acc?.missed ?? 0) + parseFloat(item.missed),
          blockConsensus: (acc?.blockConsensus ?? 0) + parseFloat(item.blockConsensus),
          blockExecution: (acc?.blockExecution ?? 0) + parseFloat(item.blockExecution),
        }),
        (acc, time) => {
          const head = acc?.head ?? 0;
          const target = acc?.target ?? 0;
          const source = acc?.source ?? 0;
          const syncCommittee = acc?.syncCommittee ?? 0;
          const missed = acc?.missed ?? 0;
          const blockConsensus = acc?.blockConsensus ?? 0;
          const blockExecution = acc?.blockExecution ?? 0;
          // Total in USD for consistent stacking (CL * tokenPrice, EL * 1 since xDAI ≈ $1)
          const clTotal =
            (head + target + source + syncCommittee + blockConsensus - missed) * tokenPrice;
          const elTotal = blockExecution; // xDAI ≈ $1
          return {
            time,
            head,
            target,
            source,
            syncCommittee,
            missed,
            blockConsensus,
            blockExecution,
            totalUsd: clTotal + elTotal,
          };
        },
      ),
    [rewardsData, timeRange, tokenPrice],
  );

  const missedStats = useMemo(() => {
    const totalMissed = chartData.reduce((sum, item) => sum + item.slot, 0);
    const maxValidators =
      chartData.length > 0 ? Math.max(...chartData.map((item) => item.validators)) : 0;
    return { totalMissed, maxValidators };
  }, [chartData]);

  const rewardsStats = useMemo(() => {
    const totals = rewardsChartData.reduce(
      (acc, item) => ({
        source: acc.source + item.source,
        target: acc.target + item.target,
        head: acc.head + item.head,
        syncCommittee: acc.syncCommittee + item.syncCommittee,
        missed: acc.missed + item.missed,
        blockConsensus: acc.blockConsensus + item.blockConsensus,
        blockExecution: acc.blockExecution + item.blockExecution,
      }),
      {
        source: 0,
        target: 0,
        head: 0,
        syncCommittee: 0,
        missed: 0,
        blockConsensus: 0,
        blockExecution: 0,
      },
    );
    return totals;
  }, [rewardsChartData]);

  // Convert chart data to USD for stacked bars (CL * tokenPrice, EL * 1)
  const rewardsChartUsd = useMemo(
    () =>
      rewardsChartData.map((d) => ({
        time: d.time,
        head: d.head * tokenPrice,
        target: d.target * tokenPrice,
        source: d.source * tokenPrice,
        syncCommittee: d.syncCommittee * tokenPrice,
        blockConsensus: d.blockConsensus * tokenPrice,
        blockExecution: d.blockExecution, // xDAI ≈ $1
        missed: d.missed * tokenPrice,
        // Keep raw values for tooltip
        _raw: d,
      })),
    [rewardsChartData, tokenPrice],
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs md:text-sm text-primary uppercase tracking-wider shrink-0">
          Analytics
        </span>
        <div className="flex-1 h-px bg-primary/20" />
      </div>

      <UnderlineTabs defaultValue="missed-attestations">
        <div className="flex items-center justify-between">
          <UnderlineTabsList className="border-b-0">
            <UnderlineTabsTrigger value="missed-attestations">Miss-Attest</UnderlineTabsTrigger>
            <UnderlineTabsTrigger value="rewards">Rewards</UnderlineTabsTrigger>
          </UnderlineTabsList>
          <Select
            value={timeRange}
            onValueChange={(value) => onTimeRangeChange(value as AnalyticsTimeRange)}
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
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:gap-4 pb-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">TOTAL MISSED</p>
                <span className="text-xl md:text-2xl font-display text-destructive">
                  {missedStats.totalMissed}
                </span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">VALIDATORS AFFECTED</p>
                <span className="text-xl md:text-2xl font-display text-warning">
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
                              <span className="text-sm font-display">{data.slot}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-xs text-muted-foreground">Validators:</span>
                              <span className="text-sm font-display">{data.validators}</span>
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
        </UnderlineTabsContent>

        <UnderlineTabsContent value="rewards" className="mt-4">
          {rewardsChartData.every((d) => d.totalUsd === 0) ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No data available
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 pb-4">
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">SOURCE</p>
                  <span className="text-base md:text-lg font-display text-[#3b82f6]">
                    {fmtToken(rewardsStats.source)} GNO
                  </span>
                </div>
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">TARGET</p>
                  <span className="text-base md:text-lg font-display text-[#10b981]">
                    {fmtToken(rewardsStats.target)} GNO
                  </span>
                </div>
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">HEAD</p>
                  <span className="text-base md:text-lg font-display text-[#8b5cf6]">
                    {fmtToken(rewardsStats.head)} GNO
                  </span>
                </div>
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">SYNC</p>
                  <span className="text-base md:text-lg font-display text-[#fbbf24]">
                    {fmtToken(rewardsStats.syncCommittee)} GNO
                  </span>
                </div>
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">
                    BLOCK (CL)
                  </p>
                  <span className="text-base md:text-lg font-display text-[#f97316]">
                    {fmtToken(rewardsStats.blockConsensus)} GNO
                  </span>
                </div>
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">
                    BLOCK (EL)
                  </p>
                  <span className="text-base md:text-lg font-display text-[#06b6d4]">
                    {fmtToken(rewardsStats.blockExecution)} xDAI
                  </span>
                </div>
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">MISSED</p>
                  <span className="text-base md:text-lg font-display text-destructive">
                    {fmtToken(rewardsStats.missed)} GNO
                  </span>
                </div>
              </div>

              <ChartContainer
                config={{
                  source: { label: 'Source', color: '#3b82f6' },
                  target: { label: 'Target', color: '#10b981' },
                  head: { label: 'Head', color: '#8b5cf6' },
                  syncCommittee: { label: 'Sync Committee', color: '#fbbf24' },
                  blockConsensus: { label: 'Block (CL)', color: '#f97316' },
                  blockExecution: { label: 'Block (EL)', color: '#06b6d4' },
                  missed: { label: 'Missed', color: '#ef4444' },
                }}
                className="h-[250px] md:h-[300px] w-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={rewardsChartUsd}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      opacity={0.3}
                    />
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
                              {raw.syncCommittee > 0 && (
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-muted-foreground">Sync Committee:</span>
                                  <span className="font-normal text-warning">
                                    {fmtToken(raw.syncCommittee)} GNO{' '}
                                    <span className="text-muted-foreground">
                                      ({toUsd(raw.syncCommittee, tokenPrice)})
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
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Missed:</span>
                                <span className="font-normal text-destructive">
                                  {fmtToken(raw.missed)} GNO{' '}
                                  <span className="text-muted-foreground">
                                    ({toUsd(raw.missed, tokenPrice)})
                                  </span>
                                </span>
                              </div>
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
                    <Bar
                      dataKey="syncCommittee"
                      stackId="rewards"
                      fill="#fbbf24"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="blockConsensus"
                      stackId="rewards"
                      fill="#f97316"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="blockExecution"
                      stackId="rewards"
                      fill="#06b6d4"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar dataKey="missed" stackId="rewards" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          )}
        </UnderlineTabsContent>
      </UnderlineTabs>
    </div>
  );
}
