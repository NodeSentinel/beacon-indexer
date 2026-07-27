'use client';

import { format } from 'date-fns';
import { useState } from 'react';

import { EmptyStateTab } from './empty-state-tab';
import { EventsTabPagination } from './events-tab-pagination';

import ArrowRight from '@/components/icons/arrow-right';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { env } from '@/env';
import type { WithdrawalEvent } from '@/hooks/use-withdrawals';
import { useWithdrawals } from '@/hooks/use-withdrawals';
import { cn, getTokenSymbol } from '@/lib/utils';

interface WithdrawalsTabProps {
  clusterId: string | null;
}

interface WithdrawalItemProps {
  tokenSymbol: string;
  withdrawal: WithdrawalEvent;
}

/**
 * Renders paginated operator-initiated withdrawal requests for the selected cluster.
 */
export function WithdrawalsTab({ clusterId }: WithdrawalsTabProps) {
  const [withdrawalsPage, setWithdrawalsPage] = useState(1);
  const { data: withdrawalsData, error, isLoading } = useWithdrawals(clusterId, withdrawalsPage);
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

  if (!withdrawalsData || withdrawalsData.withdrawals.length === 0) {
    return <EmptyStateTab message="No withdrawal requests" />;
  }

  return (
    <div className="space-y-2">
      {withdrawalsData.withdrawals.map((withdrawal) => (
        <WithdrawalItem
          key={`${withdrawal.slot}-${withdrawal.requestIndex}`}
          tokenSymbol={tokenSymbol}
          withdrawal={withdrawal}
        />
      ))}
      {(withdrawalsPage > 1 || withdrawalsData.hasNextPage) && (
        <EventsTabPagination
          currentPage={withdrawalsPage}
          hasNextPage={withdrawalsData.hasNextPage}
          onPreviousPage={() => setWithdrawalsPage((page) => Math.max(1, page - 1))}
          onNextPage={() => setWithdrawalsPage((page) => page + 1)}
        />
      )}
    </div>
  );
}

/**
 * Renders one operator withdrawal request and its execution-request details.
 */
function WithdrawalItem({ tokenSymbol, withdrawal }: WithdrawalItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isFullExit = withdrawal.type === 'full_exit';
  const requestLabel = isFullExit ? 'Full Exit' : 'Withdrawal';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <div className="flex-1 flex items-center gap-2 text-left min-w-0">
            <Badge variant="default" className="uppercase shrink-0">
              {requestLabel}
            </Badge>
            <span className="text-xs md:text-sm font-mono text-muted-foreground whitespace-nowrap">
              {format(new Date(withdrawal.timestamp), 'yyyy-MM-dd')}
            </span>
            <span className="text-xs md:text-sm font-mono whitespace-nowrap">
              Val #{withdrawal.validatorIndex}
            </span>
            <span className="text-xs md:text-sm font-normal text-success ml-auto whitespace-nowrap">
              {isFullExit ? 'Full exit' : `${withdrawal.amount} ${tokenSymbol}`}
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
            <span className="text-muted-foreground text-xs md:text-sm">Request Type</span>
            <span className="font-mono text-xs md:text-sm">{requestLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Request Index</span>
            <span className="font-mono text-xs md:text-sm">{withdrawal.requestIndex}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Validator Index</span>
            <span className="font-mono text-xs md:text-sm">{withdrawal.validatorIndex}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Slot</span>
            <span className="font-mono text-xs md:text-sm">{withdrawal.slot.toLocaleString()}</span>
          </div>
          {!isFullExit && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Amount</span>
              <span className="font-normal text-success text-xs md:text-sm">
                {withdrawal.amount} {tokenSymbol}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Timestamp</span>
            <span className="font-mono text-xs break-all">
              {new Date(withdrawal.timestamp).toISOString()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Pubkey</span>
            <span className="font-mono text-xs break-all text-right">{withdrawal.pubkey}</span>
          </div>
          {withdrawal.sourceAddress && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Source Address</span>
              <span className="font-mono text-xs break-all text-right">
                {withdrawal.sourceAddress}
              </span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
