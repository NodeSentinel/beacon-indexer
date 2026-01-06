'use client';

import { useState } from 'react';

import GroupForm from './group-form';
import GroupOverview from './group-overview';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { Group, GroupFilter, Stats } from '@/types/validator';

interface GroupListProps {
  groups: Group[];
  selectedFilter: GroupFilter;
  stats: Stats;
  gnoPrice: number;
}

function getAggregatedGroup(groups: Group[]): Group {
  const _totalValidators = groups.reduce((sum, group) => sum + group.validators.length, 0);
  const allValidators = groups.flatMap((group) => group.validators);
  const totalBalance = groups.reduce((sum, group) => sum + group.totalBalance, 0);
  const totalEffectiveBalance = groups.reduce((sum, group) => sum + group.totalEffectiveBalance, 0);
  const totalClaimable = groups.reduce((sum, group) => sum + group.claimableRewards, 0);
  const avgPerformance = groups.reduce((sum, group) => sum + group.performance, 0) / groups.length;

  return {
    id: 'all',
    name: 'All Groups',
    withdrawalAddresses: [],
    feeRecipientAddress: '-',
    validatorIndices: [],
    validators: allValidators,
    totalBalance,
    totalEffectiveBalance,
    claimableRewards: totalClaimable,
    performance: avgPerformance,
  };
}

export default function GroupList({ groups, selectedFilter, stats, gnoPrice }: GroupListProps) {
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const handleManage = (group: Group) => {
    setSelectedGroup(group);
    setIsFormOpen(true);
  };

  const displayGroup =
    selectedFilter === 'all'
      ? getAggregatedGroup(groups)
      : groups.find((g) => g.id === selectedFilter) || groups[0];

  return (
    <>
      <GroupOverview
        group={displayGroup}
        stats={stats}
        gnoPrice={gnoPrice}
        onManage={() => handleManage(displayGroup)}
      />

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <div className="mt-6">
            <GroupForm group={selectedGroup} onClose={() => setIsFormOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
