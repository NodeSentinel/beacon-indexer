'use client';

import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';

import DashboardCard from '@/components/dashboard/card';
import { ChartContainer } from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MissedAttestation } from '@/types/validator';

interface PerformanceMetricsProps {
  data: MissedAttestation[];
}

type TimeRange = '1h' | '24h' | '7d';
type MetricType = 'consensus-rewards' | 'execution-rewards' | 'missed-attestations';

export default function PerformanceMetrics({ data }: PerformanceMetricsProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [metricType, setMetricType] = useState<MetricType>('missed-attestations');

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

    // Generate mock data if filtered data is empty
    if (filteredData.length === 0) {
      const mockData: MissedAttestation[] = [];
      const intervals = timeRange === '1h' ? 12 : timeRange === '24h' ? 24 : 7;
      const intervalMs =
        timeRange === '1h'
          ? 5 * 60 * 1000
          : timeRange === '24h'
            ? 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;

      for (let i = 0; i < intervals; i++) {
        const timestamp = new Date(now.getTime() - (intervals - i) * intervalMs);
        mockData.push({
          timestamp: timestamp.toISOString(),
          count: Math.floor(Math.random() * 5),
          validatorCount: Math.floor(Math.random() * 3) + 1,
        });
      }
      filteredData = mockData;
    }

    return filteredData.map((item, i) => {
      const date = new Date(item.timestamp);
      let timeLabel = '';

      if (timeRange === '1h') {
        timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (timeRange === '24h') {
        timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else {
        timeLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }

      const executionReward = Number((Math.random() * 0.5 + 0.3).toFixed(3));

      const source = Number((0.25 + Math.random() * 0.05).toFixed(3));
      const target = Number((0.25 + Math.random() * 0.05).toFixed(3));
      const head = Number((0.25 + Math.random() * 0.05).toFixed(3));
      const syncCommittee = i % 5 === 0 ? Number((0.15 + Math.random() * 0.05).toFixed(3)) : 0; // Only some slots have sync committee
      const missed = Number((Math.random() * 0.15).toFixed(3));
      const consensusTotal = 1.0;

      return {
        time: timeLabel,
        // Missed Attestations data (yellow)
        missedValue: item.count * item.validatorCount,
        slot: item.count,
        validators: item.validatorCount,
        // Execution Rewards data (green)
        execution: executionReward,
        // Consensus Rewards data (blue + red stacked)
        source,
        target,
        head,
        syncCommittee,
        missed,
        consensusTotal,
      };
    });
  }, [data, timeRange]);

  const stats = useMemo(() => {
    if (metricType === 'missed-attestations') {
      const totalMissed = chartData.reduce((sum, item) => sum + item.slot, 0);
      const maxValidators =
        chartData.length > 0 ? Math.max(...chartData.map((item) => item.validators)) : 0;
      return { totalMissed, maxValidators };
    } else if (metricType === 'execution-rewards') {
      const totalEarned = chartData.reduce((sum, item) => sum + item.execution, 0);
      return { totalEarned: totalEarned.toFixed(2) };
    } else {
      // consensus-rewards
      const totalSource = chartData.reduce((sum, item) => sum + item.source, 0).toFixed(2);
      const totalTarget = chartData.reduce((sum, item) => sum + item.target, 0).toFixed(2);
      const totalHead = chartData.reduce((sum, item) => sum + item.head, 0).toFixed(2);
      const totalSyncCommittee = chartData
        .reduce((sum, item) => sum + item.syncCommittee, 0)
        .toFixed(2);
      const totalMissed = chartData.reduce((sum, item) => sum + item.missed, 0).toFixed(2);
      return { totalSource, totalTarget, totalHead, totalSyncCommittee, totalMissed };
    }
  }, [chartData, metricType]);

  return (
    <DashboardCard
      title="PERFORMANCE METRICS"
      intent="default"
      addon={
        <div className="flex items-center gap-2">
          <Select value={metricType} onValueChange={(value) => setMetricType(value as MetricType)}>
            <SelectTrigger className="w-36 md:w-44 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="consensus-rewards">Consensus Rewards</SelectItem>
              <SelectItem value="execution-rewards">Execution Rewards</SelectItem>
              <SelectItem value="missed-attestations">Missed Attestations</SelectItem>
            </SelectContent>
          </Select>

          {/* Time range selector */}
          <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
            <SelectTrigger className="w-16 md:w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">1h</SelectItem>
              <SelectItem value="24h" disabled>
                24h
              </SelectItem>
              <SelectItem value="7d" disabled>
                7d
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      <div className="space-y-4">
        {metricType === 'missed-attestations' ? (
          <div className="grid grid-cols-2 gap-3 md:gap-4 pb-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">TOTAL MISSED</p>
              <span className="text-xl md:text-2xl font-display text-destructive">
                {stats.totalMissed}
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">VALIDATORS AFFECTED</p>
              <span className="text-xl md:text-2xl font-display text-warning">
                {stats.maxValidators}
              </span>
            </div>
          </div>
        ) : metricType === 'execution-rewards' ? (
          <div className="grid grid-cols-1 gap-3 md:gap-4 pb-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">TOTAL EARNED</p>
              <span className="text-xl md:text-2xl font-display text-success">
                {stats.totalEarned} GNO
              </span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 pb-4">
            <div>
              <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">SOURCE</p>
              <span className="text-base md:text-lg font-display text-[#3b82f6]">
                {stats.totalSource} GNO
              </span>
            </div>
            <div>
              <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">TARGET</p>
              <span className="text-base md:text-lg font-display text-[#10b981]">
                {stats.totalTarget} GNO
              </span>
            </div>
            <div>
              <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">HEAD</p>
              <span className="text-base md:text-lg font-display text-[#8b5cf6]">
                {stats.totalHead} GNO
              </span>
            </div>
            <div>
              <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">SYNC</p>
              <span className="text-base md:text-lg font-display text-[#fbbf24]">
                {stats.totalSyncCommittee} GNO
              </span>
            </div>
            <div>
              <p className="text-[10px] md:text-[11px] text-muted-foreground mb-1">MISSED</p>
              <span className="text-base md:text-lg font-display text-destructive">
                {stats.totalMissed} GNO
              </span>
            </div>
          </div>
        )}

        {metricType === 'missed-attestations' ? (
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
        ) : metricType === 'execution-rewards' ? (
          <ChartContainer
            config={{
              execution: {
                label: 'Execution',
                color: '#10b981',
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
                            <span className="text-xs text-muted-foreground">Earned:</span>
                            <span className="text-sm font-display text-success">
                              {data.execution} GNO
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="execution" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        ) : (
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
                            <span className="font-display text-destructive">{data.missed} GNO</span>
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
                {/* Updated bar colors to distinct values */}
                <Bar dataKey="source" stackId="consensus" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                <Bar dataKey="target" stackId="consensus" fill="#10b981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="head" stackId="consensus" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                <Bar
                  dataKey="syncCommittee"
                  stackId="consensus"
                  fill="#fbbf24"
                  radius={[0, 0, 0, 0]}
                />
                <Bar dataKey="missed" stackId="consensus" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </div>
    </DashboardCard>
  );
}
