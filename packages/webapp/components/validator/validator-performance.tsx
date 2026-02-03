'use client';

import { Target, Clock, AlertTriangle, TrendingUp } from 'lucide-react';

import DashboardCard from '@/components/dashboard/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';

interface PerformanceSummary {
  attestationsTotal: number;
  attestationsMissed: number;
  performancePercentage: number;
  maxAttestationDelay: number;
}

interface ValidatorPerformanceProps {
  summary: PerformanceSummary;
}

function getPerformanceBadgeVariant(
  percentage: number,
): 'outline-success' | 'outline-warning' | 'outline-destructive' {
  if (percentage >= 98) return 'outline-success';
  if (percentage >= 90) return 'outline-warning';
  return 'outline-destructive';
}

export default function ValidatorPerformance({ summary }: ValidatorPerformanceProps) {
  const successfulAttestations = summary.attestationsTotal - summary.attestationsMissed;
  const performanceVariant = getPerformanceBadgeVariant(summary.performancePercentage);

  return (
    <DashboardCard
      title="Performance Summary"
      intent={summary.performancePercentage >= 98 ? 'success' : 'default'}
      action={
        <Badge variant={performanceVariant} className="text-sm px-3 py-1">
          {formatNumber(summary.performancePercentage)}%
        </Badge>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Attestations */}
        <div className="bg-muted/30 rounded-lg p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 bg-primary/10 rounded">
              <Target className="size-4 text-primary" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
          </div>
          <p className="text-2xl md:text-3xl font-display font-bold">
            {formatNumber(summary.attestationsTotal)}
          </p>
          <p className="text-xs text-muted-foreground">attestations</p>
        </div>

        {/* Successful Attestations */}
        <div className="bg-muted/30 rounded-lg p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 bg-success/10 rounded">
              <TrendingUp className="size-4 text-success" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Successful</p>
          </div>
          <p className="text-2xl md:text-3xl font-display font-bold text-success">
            {formatNumber(successfulAttestations)}
          </p>
          <p className="text-xs text-muted-foreground">attestations</p>
        </div>

        {/* Missed Attestations */}
        <div className="bg-muted/30 rounded-lg p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 bg-destructive/10 rounded">
              <AlertTriangle className="size-4 text-destructive" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Missed</p>
          </div>
          <p className="text-2xl md:text-3xl font-display font-bold text-destructive">
            {formatNumber(summary.attestationsMissed)}
          </p>
          <p className="text-xs text-muted-foreground">attestations</p>
        </div>
      </div>

      {/* Performance Bar */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Attestation Success Rate
          </p>
          <p className="text-sm font-medium">
            {formatNumber(successfulAttestations)} / {formatNumber(summary.attestationsTotal)}
          </p>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              summary.performancePercentage >= 98
                ? 'bg-success'
                : summary.performancePercentage >= 90
                  ? 'bg-warning'
                  : 'bg-destructive'
            }`}
            style={{ width: `${summary.performancePercentage}%` }}
          />
        </div>
      </div>
    </DashboardCard>
  );
}
