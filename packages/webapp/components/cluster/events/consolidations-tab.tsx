'use client';

import { format } from 'date-fns';
import { useState } from 'react';

import { EmptyStateTab } from './empty-state-tab';
import { EventsTabPagination } from './events-tab-pagination';

import ArrowRight from '@/components/icons/arrow-right';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ConsolidationEvent } from '@/hooks/use-consolidations';
import { useConsolidations } from '@/hooks/use-consolidations';
import { cn } from '@/lib/utils';

interface ConsolidationsTabProps {
  clusterId: string | null;
}

interface ConsolidationItemProps {
  consolidation: ConsolidationEvent;
}

/**
 * Renders the paginated consolidations list for the selected cluster.
 */
export function ConsolidationsTab({ clusterId }: ConsolidationsTabProps) {
  const [consolidationsPage, setConsolidationsPage] = useState(1);
  const {
    data: consolidationsData,
    error,
    isLoading,
  } = useConsolidations(clusterId, consolidationsPage);

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

  if (!consolidationsData || consolidationsData.consolidations.length === 0) {
    return <EmptyStateTab message="No consolidations" />;
  }

  return (
    <div className="space-y-2">
      {consolidationsData.consolidations.map((consolidation) => (
        <ConsolidationItem
          key={`${consolidation.slot}-${consolidation.requestIndex}`}
          consolidation={consolidation}
        />
      ))}
      {(consolidationsPage > 1 || consolidationsData.hasNextPage) && (
        <EventsTabPagination
          currentPage={consolidationsPage}
          hasNextPage={consolidationsData.hasNextPage}
          onPreviousPage={() => setConsolidationsPage((page) => Math.max(1, page - 1))}
          onNextPage={() => setConsolidationsPage((page) => page + 1)}
        />
      )}
    </div>
  );
}

/**
 * Renders one consolidation row and expands into request details.
 */
function ConsolidationItem({ consolidation }: ConsolidationItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const targetLabel =
    consolidation.targetValidatorIndex !== null
      ? `Val #${consolidation.targetValidatorIndex}`
      : consolidation.targetPubkey.slice(0, 10);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <div className="flex-1 flex items-center gap-2 text-left min-w-0">
            <Badge variant="default" className="uppercase shrink-0">
              Consolidation
            </Badge>
            <span className="text-xs md:text-sm font-mono text-muted-foreground whitespace-nowrap">
              {format(new Date(consolidation.timestamp), 'yyyy-MM-dd')}
            </span>
            <span className="text-xs md:text-sm font-mono whitespace-nowrap">
              Val #{consolidation.sourceValidatorIndex}
            </span>
            <span className="text-xs md:text-sm font-mono text-muted-foreground whitespace-nowrap">
              to
            </span>
            <span className="text-xs md:text-sm font-mono whitespace-nowrap">{targetLabel}</span>
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
            <span className="text-muted-foreground text-xs md:text-sm">Source Validator</span>
            <span className="font-mono text-xs md:text-sm">
              {consolidation.sourceValidatorIndex}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Target Validator</span>
            <span className="font-mono text-xs md:text-sm">
              {consolidation.targetValidatorIndex !== null
                ? consolidation.targetValidatorIndex
                : '-'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Slot</span>
            <span className="font-mono text-xs md:text-sm">
              {consolidation.slot.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Timestamp</span>
            <span className="font-mono text-xs break-all">
              {new Date(consolidation.timestamp).toISOString()}
            </span>
          </div>
          {consolidation.sourceAddress && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Source Address</span>
              <span className="font-mono text-xs break-all text-right">
                {consolidation.sourceAddress}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Source Pubkey</span>
            <span className="font-mono text-xs break-all text-right">
              {consolidation.sourcePubkey}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Target Pubkey</span>
            <span className="font-mono text-xs break-all text-right">
              {consolidation.targetPubkey}
            </span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
