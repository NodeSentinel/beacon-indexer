'use client';

import { useState } from 'react';

import GroupList from '@/components/validators/group-list';
import type { ValidatorData, NodeFilter } from '@/types/validator';
import validatorMockJson from '@/validator-mock.json';

const validatorData = validatorMockJson as ValidatorData;

export default function NodesPage() {
  const [selectedFilter] = useState<NodeFilter>('all');

  return (
    <div className="py-8 space-y-8">
      <div>
        <h1 className="text-3xl lg:text-4xl font-display mb-2">Groups</h1>
        <p className="text-sm text-muted-foreground">Manage your validator groups</p>
      </div>

      <GroupList
        groups={validatorData.groups}
        selectedFilter={selectedFilter}
        stats={validatorData.stats}
        gnoPrice={validatorData.stats.gnoPrice}
      />
    </div>
  );
}
