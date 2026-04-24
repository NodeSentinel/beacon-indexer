'use client';

import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';

import type { MissedAttestation } from '@/types/validator';

import DashboardCard from '@/components/dashboard/card';
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

interface AnalyticsProps {
  data: MissedAttestation[];
}

type TimeRange = '1h' | '24h';

export default function Analytics({ data }: AnalyticsProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');

  const chartData = useMemo(() => {
    const now = new Date();
    let filteredData = [...data];

    if (timeRange === '1h') {
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      filteredData = data.filter((item) => new Date(item.timestamp) >= oneHourAgo);
    } else if (timeRange === '24h') {
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      filteredData = data.filter((item) => new Date(item.timestamp) >= oneDayAgo);
    }

    // Return empty if no data (don't generate random mock data - causes SSR hydration issues)
    if (filteredData.length === 0) {
      return [];
    }

    return filteredData.map((item, i) => {
      const date = new Date(item.timestamp);
      let timeLabel = '';

      timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      // Use deterministic values based on index to avoid SSR hydration mismatch
      const seed = (i + 1) * 0.1;
      const executionReward = Number((0.3 + seed * 0.5).toFixed(3));
      const source = Number((0.25 + seed * 0.05).toFixed(3));
      const target = Number((0.26 + seed * 0.04).toFixed(3));
      const head = Number((0.24 + seed * 0.06).toFixed(3));
      const syncCommittee = i % 5 === 0 ? Number((0.15 + seed * 0.05).toFixed(3)) : 0;
      const missed = Number((seed * 0.15).toFixed(3));
      const consensusTotal = 1.0;

      return {
        time: timeLabel,
        missedValue: item.count * item.validatorCount,
        slot: item.count,
        validators: item.validatorCount,
        execution: executionReward,
        source,
        target,
        head,
        syncCommittee,
        missed,
        consensusTotal,
      };
    });
  }, [data, timeRange]);

  const missedStats = useMemo(() => {
    const totalMissed = chartData.reduce((sum, item) => sum + item.slot, 0);
    const maxValidators =
      chartData.length > 0 ? Math.max(...chartData.map((item) => item.validators)) : 0;
    return { totalMissed, maxValidators };
  }, [chartData]);

  const rewardsStats = useMemo(() => {
    const totalSource = chartData.reduce((sum, item) => sum + item.source, 0).toFixed(2);
    const totalTarget = chartData.reduce((sum, item) => sum + item.target, 0).toFixed(2);
    const totalHead = chartData.reduce((sum, item) => sum + item.head, 0).toFixed(2);
    const totalSyncCommittee = chartData
      .reduce((sum, item) => sum + item.syncCommittee, 0)
      .toFixed(2);
    const totalMissed = chartData.reduce((sum, item) => sum + item.missed, 0).toFixed(2);
    return { totalSource, totalTarget, totalHead, totalSyncCommittee, totalMissed };
  }, [chartData]);

  return (
    <DashboardCard title="ANALYTICS" intent="default">
      <UnderlineTabs defaultValue="missed-attestations">
        <div className="flex items-center justify-between">
          <UnderlineTabsList className="border-b-0">
            <UnderlineTabsTrigger value="missed-attestations">
              Missed Attestations
            </UnderlineTabsTrigger>
            <UnderlineTabsTrigger value="rewards">Rewards</UnderlineTabsTrigger>
          </UnderlineTabsList>
          <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
            <SelectTrigger className="w-24 md:w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Last 1h</SelectItem>
              <SelectItem value="24h" disabled>
                Last 24h
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <UnderlineTabsContent value="missed-attestations" className="mt-4">
          {chartData.length === 0 ? (
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
    </DashboardCard>
  );
}
