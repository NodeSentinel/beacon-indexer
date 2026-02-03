'use client';

import DashboardCard from '@/components/dashboard/card';
import type { Stats, Group, GroupFilter } from '@/types/validator';

interface StatsOverviewProps {
  stats: Stats;
  groups: Group[];
  selectedFilter: GroupFilter;
  gnoPrice: number;
}

export default function StatsOverview({
  stats,
  groups,
  selectedFilter,
  gnoPrice,
}: StatsOverviewProps) {
  const getFilteredStats = () => {
    if (selectedFilter === 'all') return stats;

    const group = groups.find((g) => g.id === selectedFilter);
    if (!group) return stats;

    return {
      ...stats,
      performance1h: group.performance,
    };
  };

  const filteredStats = getFilteredStats();

  const performance24h = 82.0;
  const performance7d = 91.0;
  const performance30d = 98.0;

  const getPerformanceColor = (perf: number) => {
    if (perf > 90) return 'text-success';
    if (perf > 80) return 'text-warning';
    return 'text-destructive';
  };

  return (
    <DashboardCard title="PERFORMANCE & STATS" intent="success">
      <div className="section-spacing">
        <div className="grid grid-cols-2 md:grid-cols-4 grid-spacing">
          <div>
            <p className="label-primary mb-1">1H PERF</p>
            <div className="flex items-baseline gap-2">
              <span
                className={`value-secondary ${getPerformanceColor(filteredStats.performance1h)}`}
              >
                {filteredStats.performance1h.toFixed(2)}%
              </span>
            </div>
          </div>
          <div>
            <p className="label-primary mb-1">24H PERF</p>
            <div className="flex items-baseline gap-2">
              <span className={`value-secondary ${getPerformanceColor(performance24h)}`}>
                {performance24h.toFixed(2)}%
              </span>
            </div>
          </div>
          <div>
            <p className="label-primary mb-1">7D PERF</p>
            <div className="flex items-baseline gap-2">
              <span className={`value-secondary ${getPerformanceColor(performance7d)}`}>
                {performance7d.toFixed(2)}%
              </span>
            </div>
          </div>
          <div>
            <p className="label-primary mb-1">30D PERF</p>
            <div className="flex items-baseline gap-2">
              <span className={`value-secondary ${getPerformanceColor(performance30d)}`}>
                {performance30d.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3 md:space-y-4 pt-3 md:pt-4 border-t border-border overflow-x-auto">
          <div className="min-w-[600px] md:min-w-0">
            <div className="grid grid-cols-6 gap-3 md:gap-4 text-center pb-2 md:pb-3 border-b border-border">
              <div className="label-primary">PERIOD</div>
              <div className="label-primary">APY%</div>
              <div className="label-primary">CONSENSUS</div>
              <div className="label-primary">MISSED</div>
              <div className="label-primary">EXECUTION</div>
              <div className="label-primary">TOTAL USD</div>
            </div>

            {/* Daily */}
            <div className="grid grid-cols-6 gap-3 md:gap-4 text-center py-2 md:py-3 border-b border-border/50">
              <div className="value-small">Day</div>
              <div className="value-small text-success">{filteredStats.apyDay.toFixed(2)}%</div>
              <div className="space-y-0.5">
                <div className="value-small">{filteredStats.gnoDay.toFixed(2)} GNO</div>
                <div className="text-helper">${(filteredStats.gnoDay * gnoPrice).toFixed(2)}</div>
              </div>
              <div className="space-y-0.5">
                <div className="value-small text-destructive">
                  {filteredStats.missedDay.toFixed(2)} GNO
                </div>
                <div className="text-helper">
                  ${(filteredStats.missedDay * gnoPrice).toFixed(2)}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="value-small">{filteredStats.xdaiDay.toFixed(2)} xDAI</div>
                <div className="text-helper">${filteredStats.xdaiDay.toFixed(2)}</div>
              </div>
              <div className="value-small">${filteredStats.totalDay.toFixed(2)}</div>
            </div>

            {/* Weekly */}
            <div className="grid grid-cols-6 gap-3 md:gap-4 text-center py-2 md:py-3 border-b border-border/50">
              <div className="value-small">Week</div>
              <div className="value-small text-success">{filteredStats.apyWeek.toFixed(2)}%</div>
              <div className="space-y-0.5">
                <div className="value-small">{filteredStats.gnoWeek.toFixed(2)} GNO</div>
                <div className="text-helper">${(filteredStats.gnoWeek * gnoPrice).toFixed(2)}</div>
              </div>
              <div className="space-y-0.5">
                <div className="value-small text-destructive">
                  {filteredStats.missedWeek.toFixed(2)} GNO
                </div>
                <div className="text-helper">
                  ${(filteredStats.missedWeek * gnoPrice).toFixed(2)}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="value-small">{filteredStats.xdaiWeek.toFixed(2)} xDAI</div>
                <div className="text-helper">${filteredStats.xdaiWeek.toFixed(2)}</div>
              </div>
              <div className="value-small">${filteredStats.totalWeek.toFixed(2)}</div>
            </div>

            {/* Monthly */}
            <div className="grid grid-cols-6 gap-3 md:gap-4 text-center py-2 md:py-3">
              <div className="value-small">Month</div>
              <div className="value-small text-success">{filteredStats.apyMonth.toFixed(2)}%</div>
              <div className="space-y-0.5">
                <div className="value-small">{filteredStats.gnoMonth.toFixed(2)} GNO</div>
                <div className="text-helper">${(filteredStats.gnoMonth * gnoPrice).toFixed(2)}</div>
              </div>
              <div className="space-y-0.5">
                <div className="value-small text-destructive">
                  {filteredStats.missedMonth.toFixed(2)} GNO
                </div>
                <div className="text-helper">
                  ${(filteredStats.missedMonth * gnoPrice).toFixed(2)}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="value-small">{filteredStats.xdaiMonth.toFixed(2)} xDAI</div>
                <div className="text-helper">${filteredStats.xdaiMonth.toFixed(2)}</div>
              </div>
              <div className="value-small">${filteredStats.totalMonth.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}
