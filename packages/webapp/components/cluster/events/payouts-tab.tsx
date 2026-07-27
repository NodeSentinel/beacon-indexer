'use client';

import { format } from 'date-fns';
import { useState } from 'react';

import { EmptyStateTab } from './empty-state-tab';
import { EventsTabPagination } from './events-tab-pagination';

import ArrowRight from '@/components/icons/arrow-right';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { env } from '@/env';
import type { PayoutEvent } from '@/hooks/use-payouts';
import { usePayouts } from '@/hooks/use-payouts';
import { cn, getTokenSymbol } from '@/lib/utils';

interface PayoutsTabProps {
  clusterId: string | null;
}

interface PayoutItemProps {
  payout: PayoutEvent;
  tokenSymbol: string;
}

/**
 * Renders paginated completed beacon-chain payouts for the selected cluster.
 */
export function PayoutsTab({ clusterId }: PayoutsTabProps) {
  const [payoutsPage, setPayoutsPage] = useState(1);
  const { data: payoutsData, error, isLoading } = usePayouts(clusterId, payoutsPage);
  const tokenSymbol = getTokenSymbol(env.NEXT_PUBLIC_CHAIN);

  if (!clusterId) {
    return <EmptyStateTab message="Select a cluster" />;
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-16 bg-foreground/5 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive text-center py-8">{error.message}</p>;
  }

  if (!payoutsData || payoutsData.payouts.length === 0) {
    return <EmptyStateTab message="No payouts" />;
  }

  return (
    <div className="space-y-2">
      {payoutsData.payouts.map((payout) => (
        <PayoutItem key={payout.index} payout={payout} tokenSymbol={tokenSymbol} />
      ))}
      {(payoutsPage > 1 || payoutsData.hasNextPage) && (
        <EventsTabPagination
          currentPage={payoutsPage}
          hasNextPage={payoutsData.hasNextPage}
          onPreviousPage={() => setPayoutsPage((page) => Math.max(1, page - 1))}
          onNextPage={() => setPayoutsPage((page) => page + 1)}
        />
      )}
    </div>
  );
}

/**
 * Renders one completed payout and its beacon-chain details.
 */
function PayoutItem({ payout, tokenSymbol }: PayoutItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <div className="flex-1 flex items-center gap-2 text-left min-w-0">
            <Badge variant="default" className="uppercase shrink-0">
              Payout
            </Badge>
            <span className="text-xs md:text-sm font-mono text-muted-foreground whitespace-nowrap">
              {format(new Date(payout.timestamp), 'yyyy-MM-dd')}
            </span>
            <span className="text-xs md:text-sm font-mono whitespace-nowrap">
              Val #{payout.validatorIndex}
            </span>
            <span className="text-xs md:text-sm font-normal text-success ml-auto whitespace-nowrap">
              {payout.amount} {tokenSymbol}
            </span>
          </div>

          <ArrowRight
            className={cn(
              'size-4 text-foreground/60 transition-transform flex-shrink-0',
              isOpen && 'rotate-90',
              'group-hover:text-foreground',
            )}
          />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 py-3 ml-6 md:ml-11 space-y-2 text-sm border-l-2 border-border">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Payout Index</span>
            <span className="font-mono text-xs md:text-sm">{payout.index}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Validator Index</span>
            <span className="font-mono text-xs md:text-sm">{payout.validatorIndex}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Slot</span>
            <span className="font-mono text-xs md:text-sm">{payout.slot.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Amount</span>
            <span className="font-normal text-success text-xs md:text-sm">
              {payout.amount} {tokenSymbol}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Timestamp</span>
            <span className="font-mono text-xs break-all">
              {new Date(payout.timestamp).toISOString()}
            </span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
