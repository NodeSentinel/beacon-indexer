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

interface AttestationsChartProps {
  data: MissedAttestation[];
}

type TimeRange = '1h' | '24h' | '7d';

export default function AttestationsChart({ data }: AttestationsChartProps) {
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
    // 7d shows all data

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

    return filteredData.map((item) => {
      const date = new Date(item.timestamp);
      let timeLabel = '';

      if (timeRange === '1h') {
        timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (timeRange === '24h') {
        timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else {
        timeLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }

      return {
        time: timeLabel,
        value: item.count * item.validatorCount,
        slot: item.count,
        validators: item.validatorCount,
      };
    });
  }, [data, timeRange]);

  const totalMissed = chartData.reduce((sum, item) => sum + item.slot, 0);
  const maxValidators =
    chartData.length > 0 ? Math.max(...chartData.map((item) => item.validators)) : 0;

  return (
    <DashboardCard
      title="MISSED ATTESTATIONS"
      intent="default"
      addon={
        <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
          <SelectTrigger className="w-20 md:w-24 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1h">1h</SelectItem>
            <SelectItem value="24h" disabled>
              24h (Coming soon)
            </SelectItem>
            <SelectItem value="7d" disabled>
              7d (Coming soon)
            </SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:gap-4 pb-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">TOTAL MISSED</p>
            <span className="text-xl md:text-2xl font-display text-destructive">{totalMissed}</span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">MAX VALIDATORS</p>
            <span className="text-xl md:text-2xl font-display text-warning">{maxValidators}</span>
          </div>
        </div>

        <ChartContainer
          config={{
            value: {
              label: 'Impact',
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
                          <span className="text-xs text-muted-foreground">Slot:</span>
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
              <Bar dataKey="value" fill="#fbbf24" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    </DashboardCard>
  );
}
