'use client';

import { useState } from 'react';

import ArrowRight from '@/components/icons/arrow-right';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  UnderlineTabs,
  UnderlineTabsContent,
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from '@/components/underline-tabs';
import { useBlockProposals } from '@/hooks/use-block-proposals';
import { cn, formatTime } from '@/lib/utils';
import type { ValidatorEvent, Validator } from '@/types/validator';

interface EventsFeedContentProps {
  clusterId: string | null;
  events: ValidatorEvent[];
  validators: Validator[];
  gnoPrice: number;
}

export default function EventsFeedContent({
  clusterId,
  events,
  validators: _validators,
  gnoPrice,
}: EventsFeedContentProps) {
  const [blocksPage, setBlocksPage] = useState(1);

  const { data: blocksData, isLoading: blocksLoading } = useBlockProposals(
    clusterId ? { clusterId } : null,
    blocksPage,
  );

  const incidentEvents = events.filter((e) => e.type === 'inactive' || e.type === 'slashed');

  // Group incidents by timestamp and type for display
  const groupedIncidents = incidentEvents.reduce(
    (acc, event) => {
      const key = `${event.timestamp}-${event.type}`;
      if (!acc[key]) {
        acc[key] = {
          timestamp: event.timestamp,
          type: event.type,
          validators: [],
          details: event.details,
        };
      }
      acc[key].validators.push(event.validatorIndex);
      return acc;
    },
    {} as Record<
      string,
      { timestamp: string; type: string; validators: number[]; details: string }
    >,
  );

  const incidents = Object.values(groupedIncidents);

  const consolidations = events.filter((e) => e.type === 'consolidation');
  const deposits = events.filter((e) => e.type === 'deposit');
  const withdrawals = events.filter(
    (e) => e.type === 'partial_withdrawal' || e.type === 'full_withdrawal',
  );

  const totalBlockPages = blocksData ? Math.ceil(blocksData.totalCount / blocksData.pageSize) : 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs md:text-sm text-primary uppercase tracking-wider shrink-0">
          Events
        </span>
        <div className="flex-1 h-px bg-primary/20" />
      </div>
      <UnderlineTabs defaultValue="blocks">
        <UnderlineTabsList>
          <UnderlineTabsTrigger value="blocks">Blocks</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="incidents">Incidents</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="consolidations">Consolidations</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="deposits">Deposits</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="withdrawals">Withdrawals</UnderlineTabsTrigger>
        </UnderlineTabsList>

        <UnderlineTabsContent value="incidents" className="space-y-2 mt-4 min-h-[400px]">
          {incidents.length > 0 ? (
            <div className="space-y-2">
              {incidents.map((incident, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 md:gap-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30"
                >
                  <div className="text-xl md:text-2xl font-display flex-shrink-0 text-destructive">
                    {incident.type === 'slashed' ? '✕' : '⚠'}
                  </div>

                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="destructive" className="text-xs">
                        {incident.type === 'slashed' ? 'Slashed' : 'Inactive'}
                      </Badge>
                      <span className="text-xs font-mono text-muted-foreground">
                        {incident.validators.length} validator
                        {incident.validators.length !== 1 ? 's' : ''} affected
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Date: </span>
                        <span className="font-medium">{formatTime(incident.timestamp)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Duration: </span>
                        <span className="font-medium">2h 15m</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cost: </span>
                        <span className="font-mono font-medium text-destructive">
                          {(0.05 * incident.validators.length).toFixed(2)} GNO
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">USD: </span>
                        <span className="font-mono font-medium">
                          ${(0.05 * incident.validators.length * gnoPrice).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No incidents</p>
          )}
        </UnderlineTabsContent>

        <UnderlineTabsContent value="consolidations" className="space-y-2 mt-4 min-h-[400px]">
          {consolidations.length > 0 ? (
            consolidations.map((event) => (
              <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No consolidations</p>
          )}
        </UnderlineTabsContent>

        <UnderlineTabsContent value="blocks" className="space-y-2 mt-4 min-h-[400px]">
          {blocksLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 bg-foreground/5 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : blocksData && blocksData.blocks.length > 0 ? (
            <div className="space-y-2">
              {blocksData.blocks.map((block) => (
                <BlockItem key={block.slot} block={block} />
              ))}
              {totalBlockPages > 1 && (
                <div className="flex items-center justify-between pt-3 border-t border-border/50">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBlocksPage((p) => Math.max(1, p - 1))}
                    disabled={blocksPage <= 1}
                  >
                    Prev
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {blocksPage} of {totalBlockPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBlocksPage((p) => Math.min(totalBlockPages, p + 1))}
                    disabled={blocksPage >= totalBlockPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No blocks proposed</p>
          )}
        </UnderlineTabsContent>

        <UnderlineTabsContent value="deposits" className="space-y-2 mt-4 min-h-[400px]">
          {deposits.length > 0 ? (
            deposits.map((event) => <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No deposits</p>
          )}
        </UnderlineTabsContent>

        <UnderlineTabsContent value="withdrawals" className="space-y-2 mt-4 min-h-[400px]">
          {withdrawals.length > 0 ? (
            withdrawals.map((event) => (
              <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No withdrawals</p>
          )}
        </UnderlineTabsContent>
      </UnderlineTabs>
    </div>
  );
}

interface BlockItemProps {
  block: {
    slot: number;
    blockNumber: number | null;
    validatorIndex: number;
    timestamp: number;
    consensusReward: string | null;
    executionReward: string | null;
  };
}

function BlockItem({ block }: BlockItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 md:gap-3 p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <div className="text-xl md:text-2xl font-display flex-shrink-0 text-chart-1">■</div>

          <div className="flex-1 text-left min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="default" className="text-xs">
                Block Proposed
              </Badge>
              <span className="text-xs font-mono text-muted-foreground">
                Val #{block.validatorIndex}
              </span>
            </div>
            <p className="text-sm line-clamp-1">
              Slot {block.slot.toLocaleString()}
              {block.blockNumber !== null && ` · Block #${block.blockNumber.toLocaleString()}`}
            </p>
          </div>

          <div className="flex flex-col md:flex-row items-end md:items-center gap-1 md:gap-3 flex-shrink-0">
            {block.consensusReward && (
              <span className="text-xs md:text-sm font-display text-success whitespace-nowrap">
                {block.consensusReward} GNO
              </span>
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap hidden md:inline">
              {formatTime(new Date(block.timestamp).toISOString())}
            </span>
            <ArrowRight
              className={cn(
                'size-5 text-foreground/60 transition-transform flex-shrink-0',
                isOpen && 'rotate-90',
                'group-hover:text-foreground',
              )}
            />
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 py-3 ml-6 md:ml-11 space-y-2 text-sm border-l-2 border-border">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Validator Index</span>
            <span className="font-mono text-xs md:text-sm">{block.validatorIndex}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Slot</span>
            <span className="font-mono text-xs md:text-sm">{block.slot.toLocaleString()}</span>
          </div>
          {block.blockNumber !== null && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Block Number</span>
              <span className="font-mono text-xs md:text-sm">
                {block.blockNumber.toLocaleString()}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Timestamp</span>
            <span className="font-mono text-xs break-all">
              {new Date(block.timestamp).toISOString()}
            </span>
          </div>
          {block.consensusReward && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Consensus Reward</span>
              <span className="font-display text-success text-xs md:text-sm">
                {block.consensusReward} GNO
              </span>
            </div>
          )}
          {block.executionReward && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Execution Reward</span>
              <span className="font-display text-success text-xs md:text-sm">
                {block.executionReward}
              </span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface EventItemProps {
  event: ValidatorEvent;
  gnoPrice: number;
}

function EventItem({ event, gnoPrice: _gnoPrice }: EventItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  const getEventIcon = (type: ValidatorEvent['type']) => {
    switch (type) {
      case 'deposit':
        return '↓';
      case 'partial_withdrawal':
        return '↑';
      case 'full_withdrawal':
        return '⇈';
      case 'inactive':
        return '⚠';
      case 'block_proposed':
        return '■';
      case 'sync_committee':
        return '⚡';
      case 'slashed':
        return '✕';
      case 'attestation':
        return '✓';
      case 'consolidation':
        return '⇄';
    }
  };

  const getEventVariant = (type: ValidatorEvent['type']) => {
    switch (type) {
      case 'deposit':
        return 'default';
      case 'partial_withdrawal':
      case 'full_withdrawal':
        return 'default';
      case 'inactive':
      case 'slashed':
        return 'destructive';
      case 'block_proposed':
      case 'sync_committee':
      case 'attestation':
      case 'consolidation':
        return 'default';
    }
  };

  const getEventColor = (type: ValidatorEvent['type']) => {
    switch (type) {
      case 'deposit':
        return 'text-chart-2';
      case 'partial_withdrawal':
      case 'full_withdrawal':
        return 'text-success';
      case 'inactive':
      case 'slashed':
        return 'text-destructive';
      case 'block_proposed':
        return 'text-chart-1';
      case 'sync_committee':
        return 'text-warning';
      case 'attestation':
        return 'text-positive';
      case 'consolidation':
        return 'text-chart-3';
    }
  };

  const formatEventType = (type: ValidatorEvent['type']) => {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 md:gap-3 p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <div
            className={cn(
              'text-xl md:text-2xl font-display flex-shrink-0',
              getEventColor(event.type),
            )}
          >
            {getEventIcon(event.type)}
          </div>

          <div className="flex-1 text-left min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={getEventVariant(event.type)} className="text-xs">
                {formatEventType(event.type)}
              </Badge>
              <span className="text-xs font-mono text-muted-foreground">
                Val #{event.validatorIndex}
              </span>
            </div>
            <p className="text-sm line-clamp-2 md:line-clamp-1">{event.details}</p>
          </div>

          <div className="flex flex-col md:flex-row items-end md:items-center gap-1 md:gap-3 flex-shrink-0">
            {event.amount && (
              <span className="text-xs md:text-sm font-display text-success whitespace-nowrap">
                {event.amount} GNO
              </span>
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap hidden md:inline">
              {formatTime(event.timestamp)}
            </span>
            <ArrowRight
              className={cn(
                'size-5 text-foreground/60 transition-transform flex-shrink-0',
                isOpen && 'rotate-90',
                'group-hover:text-foreground',
              )}
            />
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 py-3 ml-6 md:ml-11 space-y-2 text-sm border-l-2 border-border">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Validator Index</span>
            <span className="font-mono text-xs md:text-sm">{event.validatorIndex}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs md:text-sm">Timestamp</span>
            <span className="font-mono text-xs break-all">
              {new Date(event.timestamp).toISOString()}
            </span>
          </div>
          {event.amount && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Amount</span>
              <span className="font-display text-success text-xs md:text-sm">
                {event.amount} GNO
              </span>
            </div>
          )}
          {event.blockNumber && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Block Number</span>
              <span className="font-mono text-xs md:text-sm">
                {event.blockNumber.toLocaleString()}
              </span>
            </div>
          )}
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">{event.details}</p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
