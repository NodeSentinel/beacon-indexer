'use client';

import { PayoutsTab } from './payouts-tab';
import { WithdrawalsTab } from './withdrawals-tab';

import {
  UnderlineTabs,
  UnderlineTabsContent,
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from '@/components/underline-tabs';

interface WithdrawalEventsProps {
  clusterId: string | null;
}

/**
 * Separates completed payouts from operator-initiated withdrawal requests.
 */
export function WithdrawalEvents({ clusterId }: WithdrawalEventsProps) {
  return (
    <UnderlineTabs defaultValue="payouts">
      <UnderlineTabsList>
        <UnderlineTabsTrigger value="payouts">Payouts</UnderlineTabsTrigger>
        <UnderlineTabsTrigger value="withdrawals">Withdrawal Requests</UnderlineTabsTrigger>
      </UnderlineTabsList>

      <UnderlineTabsContent value="payouts" className="space-y-2 mt-4">
        <PayoutsTab clusterId={clusterId} />
      </UnderlineTabsContent>

      <UnderlineTabsContent value="withdrawals" className="space-y-2 mt-4">
        <WithdrawalsTab clusterId={clusterId} />
      </UnderlineTabsContent>
    </UnderlineTabs>
  );
}
