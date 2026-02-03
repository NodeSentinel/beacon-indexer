'use client';

import { Settings } from 'lucide-react';

import DashboardCard from '@/components/dashboard/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Group } from '@/types/validator';

interface GroupCardProps {
  group: Group;
  onManage: () => void;
  gnoPrice: number; // Added gnoPrice prop
}

export default function GroupCard({ group, onManage, gnoPrice }: GroupCardProps) {
  const statusCounts = group.validators.reduce(
    (acc, v) => {
      acc[v.status] = (acc[v.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const getStatusDisplay = () => {
    const displays: { emoji: string; count: number; label: string }[] = [];

    if (statusCounts.active)
      displays.push({
        emoji: '🟢',
        count: statusCounts.active,
        label: 'active',
      });
    if (statusCounts.inactive)
      displays.push({
        emoji: '🟡',
        count: statusCounts.inactive,
        label: 'inactive',
      });
    if (statusCounts.active_exiting)
      displays.push({
        emoji: '🟠',
        count: statusCounts.active_exiting,
        label: 'active exiting',
      });
    if (statusCounts.slashed)
      displays.push({
        emoji: '🚫',
        count: statusCounts.slashed,
        label: 'slashed',
      });
    if (statusCounts.exited)
      displays.push({
        emoji: '🔚',
        count: statusCounts.exited,
        label: 'exited',
      });

    return displays;
  };

  const totalValidators = group.validators.length;

  const balanceUsd = (group.totalBalance * gnoPrice).toFixed(2);
  const effectiveBalanceUsd = (group.totalEffectiveBalance * gnoPrice).toFixed(0);
  const claimableUsd = (group.claimableRewards * gnoPrice).toFixed(2);

  return (
    <DashboardCard
      title={
        <div className="flex items-center gap-2 md:gap-3 flex-wrap justify-center">
          <span>{group.name}</span>
          <Badge
            variant="outline"
            className="text-sm md:text-base font-display px-2.5 md:px-3 py-0.5"
          >
            {totalValidators} validators
          </Badge>
        </div>
      }
      intent={group.performance >= 98 ? 'success' : 'default'}
    >
      <div className="section-spacing">
        <div className="grid grid-cols-1 sm:grid-cols-3 grid-spacing pb-3 md:pb-4 border-b border-border">
          <div>
            <p className="label-primary mb-1">BALANCE</p>
            <span className="value-secondary">{group.totalBalance.toFixed(2)} GNO</span>
            <p className="text-helper">${balanceUsd}</p>
          </div>
          <div>
            <p className="label-primary mb-1">EFFECTIVE BALANCE</p>
            <span className="value-secondary">{group.totalEffectiveBalance.toFixed(0)} GNO</span>
            <p className="text-helper">${effectiveBalanceUsd}</p>
          </div>
          <div>
            <p className="label-primary mb-1">CLAIMABLE</p>
            <span className="value-secondary text-success">
              {group.claimableRewards.toFixed(2)} GNO
            </span>
            <p className="text-helper">${claimableUsd}</p>
          </div>
        </div>

        <div>
          <p className="label-primary mb-2">VALIDATORS</p>
          <div className="flex flex-wrap items-center gap-2 md:gap-3 text-sm">
            {getStatusDisplay().map((status, idx) => (
              <span key={idx} className="flex items-center gap-1">
                <span className="text-base">{status.emoji}</span>
                <span className="font-medium">{status.count}</span>
                <span className="text-helper">{status.label}</span>
                {idx < getStatusDisplay().length - 1 && (
                  <span className="text-muted-foreground ml-1">|</span>
                )}
              </span>
            ))}
          </div>
        </div>

        <Button variant="outline" className="w-full bg-transparent" onClick={onManage}>
          <Settings className="size-4 mr-2" />
          Manage
        </Button>
      </div>
    </DashboardCard>
  );
}
