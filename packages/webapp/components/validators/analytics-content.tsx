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
import type { MissedAttestation } from '@/types/validator';

interface AnalyticsContentProps {
  data: MissedAttestation[];
  timeRange: '1h' | '24h';
  onTimeRangeChange: (range: '1h' | '24h') => void;
}

export default function AnalyticsContent({
  data,
  timeRange,
  onTimeRangeChange,
}: AnalyticsContentProps) {
  const chartData = useMemo(() => {
    const now = Date.now();

    // Build fixed time buckets: 1h = 6 buckets of 10min, 24h = 24 buckets of 1h
    const bucketMs = timeRange === '1h' ? 10 * 60 * 1000 : 60 * 60 * 1000;
    const totalMs = timeRange === '1h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const bucketCount = totalMs / bucketMs;

    // Align start to bucket boundary
    const start = Math.floor((now - totalMs) / bucketMs) * bucketMs;

    // Aggregate data into buckets
    const dataByBucket = new Map<number, { count: number; maxValidators: number }>();
    for (const item of data) {
      const ts = new Date(item.timestamp).getTime();
      if (ts < start) continue;
      const bucketKey = Math.floor((ts - start) / bucketMs);
      if (bucketKey >= bucketCount) continue;
      const existing = dataByBucket.get(bucketKey);
      if (existing) {
        existing.count += item.count;
        existing.maxValidators = Math.max(existing.maxValidators, item.validatorCount);
      } else {
        dataByBucket.set(bucketKey, { count: item.count, maxValidators: item.validatorCount });
      }
    }

    return Array.from({ length: bucketCount }, (_, i) => {
      const bucketStart = new Date(start + i * bucketMs);
      const timeLabel = bucketStart.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const bucket = dataByBucket.get(i);

      return {
        time: timeLabel,
        missedValue: bucket?.count ?? 0,
        slot: bucket?.count ?? 0,
        validators: bucket?.maxValidators ?? 0,
      };
    });
  }, [data, timeRange]);

  const missedStats = useMemo(() => {
    const totalMissed = chartData.reduce((sum, item) => sum + item.slot, 0);
    const maxValidators =
      chartData.length > 0 ? Math.max(...chartData.map((item) => item.validators)) : 0;
    return { totalMissed, maxValidators };
  }, [chartData]);

  // Rewards tab uses placeholder stats until rewards endpoint is implemented
  const rewardsStats = useMemo(() => {
    return {
      totalSource: '0.00',
      totalTarget: '0.00',
      totalHead: '0.00',
      totalSyncCommittee: '0.00',
      totalMissed: '0.00',
    };
  }, []);

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
            onValueChange={(value) => onTimeRangeChange(value as '1h' | '24h')}
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
          {data.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No data available
            </div>
          ) : (
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
          )}
        </UnderlineTabsContent>

        <UnderlineTabsContent value="rewards" className="mt-4">
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No data available
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 pb-4">
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">SOURCE</p>
                  <span className="text-base md:text-lg font-display text-[#3b82f6]">
                    {rewardsStats.totalSource} GNO
                  </span>
                </div>
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">TARGET</p>
                  <span className="text-base md:text-lg font-display text-[#10b981]">
                    {rewardsStats.totalTarget} GNO
                  </span>
                </div>
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">HEAD</p>
                  <span className="text-base md:text-lg font-display text-[#8b5cf6]">
                    {rewardsStats.totalHead} GNO
                  </span>
                </div>
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">SYNC</p>
                  <span className="text-base md:text-lg font-display text-[#fbbf24]">
                    {rewardsStats.totalSyncCommittee} GNO
                  </span>
                </div>
                <div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">MISSED</p>
                  <span className="text-base md:text-lg font-display text-destructive">
                    {rewardsStats.totalMissed} GNO
                  </span>
                </div>
              </div>

              <ChartContainer
                config={{
                  source: {
                    label: 'Source',
                    color: '#3b82f6',
                  },
                  target: {
                    label: 'Target',
                    color: '#10b981',
                  },
                  head: {
                    label: 'Head',
                    color: '#8b5cf6',
                  },
                  syncCommittee: {
                    label: 'Sync Committee',
                    color: '#fbbf24',
                  },
                  missed: {
                    label: 'Missed',
                    color: '#ef4444',
                  },
                }}
                className="h-[250px] md:h-[300px] w-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="rounded-lg border bg-background p-3 shadow-md">
                            <div className="space-y-1 text-xs">
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Source:</span>
                                <span className="font-display" style={{ color: '#3b82f6' }}>
                                  {data.source} GNO
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Target:</span>
                                <span className="font-display" style={{ color: '#10b981' }}>
                                  {data.target} GNO
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Head:</span>
                                <span className="font-display" style={{ color: '#8b5cf6' }}>
                                  {data.head} GNO
                                </span>
                              </div>
                              {data.syncCommittee > 0 && (
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-muted-foreground">Sync Committee:</span>
                                  <span className="font-display text-warning">
                                    {data.syncCommittee} GNO
                                  </span>
                                </div>
                              )}
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Missed:</span>
                                <span className="font-display text-destructive">
                                  {data.missed} GNO
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4 pt-1 border-t">
                                <span className="text-muted-foreground">Total:</span>
                                <span className="font-display">{data.consensusTotal} GNO</span>
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="source"
                      stackId="consensus"
                      fill="#3b82f6"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="target"
                      stackId="consensus"
                      fill="#10b981"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar dataKey="head" stackId="consensus" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                    <Bar
                      dataKey="syncCommittee"
                      stackId="consensus"
                      fill="#fbbf24"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="missed"
                      stackId="consensus"
                      fill="#ef4444"
                      radius={[4, 4, 0, 0]}
                    />
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
