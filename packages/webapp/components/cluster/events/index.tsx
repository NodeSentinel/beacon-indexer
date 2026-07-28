'use client';

import { useState } from 'react';

import { BlocksTab } from './blocks-tab';
import { ConsolidationsTab } from './consolidations-tab';
import { DepositsTab } from './deposits-tab';
import { IncidentsTab } from './incidents-tab';
import { PayoutsTab } from './payouts-tab';
import { WithdrawalsTab } from './withdrawals-tab';

import {
  UnderlineTabs,
  UnderlineTabsContent,
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from '@/components/underline-tabs';

interface EventsFeedContentProps {
  clusterId: string | null;
}

/** Renders the events tabs shell for a validator cluster. */
export default function EventsFeedContent({ clusterId }: EventsFeedContentProps) {
  const [activeTab, setActiveTab] = useState('incidents');

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs md:text-sm text-primary uppercase tracking-wider shrink-0">
          Events
        </span>
        <div className="flex-1 h-px bg-primary/20" />
      </div>
      <UnderlineTabs defaultValue="incidents" value={activeTab} onValueChange={setActiveTab}>
        <UnderlineTabsList>
          <UnderlineTabsTrigger value="incidents">Incidents</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="blocks">Blocks</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="consolidations">Consolidations</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="deposits">Deposits</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="payouts">Payouts</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="withdrawal-requests">
            Withdrawal Requests
          </UnderlineTabsTrigger>
        </UnderlineTabsList>

        <UnderlineTabsContent value="incidents" className="space-y-2 mt-4 min-h-[400px]">
          <IncidentsTab clusterId={clusterId} isActive={activeTab === 'incidents'} />
        </UnderlineTabsContent>

        <UnderlineTabsContent value="blocks" className="space-y-2 mt-4 min-h-[400px]">
          <BlocksTab clusterId={clusterId} />
        </UnderlineTabsContent>

        <UnderlineTabsContent value="consolidations" className="space-y-2 mt-4 min-h-[400px]">
          <ConsolidationsTab clusterId={clusterId} />
        </UnderlineTabsContent>

        <UnderlineTabsContent value="deposits" className="space-y-2 mt-4 min-h-[400px]">
          <DepositsTab clusterId={clusterId} />
        </UnderlineTabsContent>

        <UnderlineTabsContent value="payouts" className="space-y-2 mt-4 min-h-[400px]">
          <PayoutsTab clusterId={clusterId} />
        </UnderlineTabsContent>

        <UnderlineTabsContent value="withdrawal-requests" className="space-y-2 mt-4 min-h-[400px]">
          <WithdrawalsTab clusterId={clusterId} />
        </UnderlineTabsContent>
      </UnderlineTabs>
    </div>
  );
}
