'use client';

import { format } from 'date-fns';
import { useState } from 'react';

import { EmptyStateTab } from './empty-state-tab';
import { EventsTabPagination } from './events-tab-pagination';

import ArrowRight from '@/components/icons/arrow-right';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { env } from '@/env';
import type { DepositEvent } from '@/hooks/use-deposits';
import { useDeposits } from '@/hooks/use-deposits';
import { cn, getTokenSymbol } from '@/lib/utils';

interface DepositsTabProps {
  clusterId: string | null;
}

interface DepositItemProps {
  deposit: DepositEvent;
  tokenSymbol: string;
}

/**
 * Renders the paginated deposits list for the selected cluster.
 */
export function DepositsTab({ clusterId }: DepositsTabProps) {
  const [depositsPage, setDepositsPage] = useState(1);
  const { data: depositsData, error, isLoading } = useDeposits(clusterId, depositsPage);
  const totalDepositPages = depositsData
    ? Math.ceil(depositsData.totalCount / depositsData.pageSize)
    : 0;
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

  if (!depositsData || depositsData.deposits.length === 0) {
    return <EmptyStateTab message="No deposits" />;
  }

  return (
    <div className="space-y-2">
      {depositsData.deposits.map((deposit) => (
        <DepositItem
          key={`${deposit.slot}-${deposit.source}-${deposit.index}`}
          deposit={deposit}
          tokenSymbol={tokenSymbol}
        />
      ))}
      {totalDepositPages > 1 && (
        <EventsTabPagination
          currentPage={depositsPage}
          totalPages={totalDepositPages}
          onPreviousPage={() => setDepositsPage((page) => Math.max(1, page - 1))}
          onNextPage={() => setDepositsPage((page) => Math.min(totalDepositPages, page + 1))}
        />
      )}
    </div>
  );
}

/**
 * Renders one deposit row and expands into deposit details.
 */
function DepositItem({ deposit, tokenSymbol }: DepositItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const sourceLabel = deposit.source === 'execution_request' ? 'Execution Request' : 'Beacon Body';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <div className="flex-1 flex items-center gap-2 text-left min-w-0">
            <Badge variant="default" className="uppercase shrink-0">
              Deposit
            </Badge>
            <span className="text-xs md:text-sm font-mono text-muted-foreground whitespace-nowrap">
              {format(new Date(deposit.timestamp), 'yyyy-MM-dd')}
            </span>
            <span className="text-xs md:text-sm font-mono whitespace-nowrap">
              Val #{deposit.validatorIndex}
            </span>
            <span className="text-xs md:text-sm font-normal text-success ml-auto whitespace-nowrap">
              {deposit.amount} {tokenSymbol}
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
            <span className="text-muted-foreground text-xs md:text-sm">Validator Index</span>
            <span className="font-mono text-xs md:text-sm">{deposit.validatorIndex}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Slot</span>
            <span className="font-mono text-xs md:text-sm">{deposit.slot.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Source</span>
            <span className="font-mono text-xs md:text-sm">{sourceLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Amount</span>
            <span className="font-normal text-success text-xs md:text-sm">
              {deposit.amount} {tokenSymbol}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Timestamp</span>
            <span className="font-mono text-xs break-all">
              {new Date(deposit.timestamp).toISOString()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Pubkey</span>
            <span className="font-mono text-xs break-all text-right">{deposit.pubkey}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Withdrawal Credentials</span>
            <span className="font-mono text-xs break-all text-right">
              {deposit.withdrawalCredentials}
            </span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
