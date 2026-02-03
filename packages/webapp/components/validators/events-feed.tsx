'use client';

import { useState } from 'react';

import DashboardCard from '@/components/dashboard/card';
import ArrowRight from '@/components/icons/arrow-right';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/utils'; // Import formatTime function
import type { ValidatorEvent, Validator } from '@/types/validator';

interface EventsFeedProps {
  events: ValidatorEvent[];
  validators: Validator[];
  gnoPrice: number;
}

export default function EventsFeed({ events, validators: _validators, gnoPrice }: EventsFeedProps) {
  const [validatorFilter, setValidatorFilter] = useState<string>('');

  const filterEventsByValidator = (eventList: ValidatorEvent[]) => {
    if (!validatorFilter.trim()) return eventList;

    const filterIndices = validatorFilter
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '');

    if (filterIndices.length === 0) return eventList;

    return eventList.filter((e) =>
      filterIndices.some((index) => e.validatorIndex.toString() === index),
    );
  };

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

  const consolidations = filterEventsByValidator(events.filter((e) => e.type === 'consolidation'));
  const blocks = filterEventsByValidator(events.filter((e) => e.type === 'block_proposed'));
  const deposits = filterEventsByValidator(events.filter((e) => e.type === 'deposit'));
  const withdrawals = filterEventsByValidator(
    events.filter((e) => e.type === 'partial_withdrawal' || e.type === 'full_withdrawal'),
  );

  return (
    <DashboardCard
      title="EVENTS"
      intent="default"
      addon={
        <Input
          placeholder="Filter validators (e.g., 123, 456)"
          value={validatorFilter}
          onChange={(e) => setValidatorFilter(e.target.value)}
          className="w-48 md:w-64 h-8 text-xs md:text-sm"
          disabled
        />
      }
    >
      <Tabs defaultValue="incidents" className="w-full">
        <div className="overflow-x-auto -mx-1 px-1 scrollbar-thin">
          <TabsList className="inline-flex w-auto min-w-full md:grid md:w-full md:grid-cols-5 h-auto">
            <TabsTrigger value="incidents" className="h-10 flex-shrink-0 px-3 md:px-3">
              Incidents
            </TabsTrigger>
            <TabsTrigger value="consolidations" className="h-10 flex-shrink-0 px-3 md:px-3">
              Consolidations
            </TabsTrigger>
            <TabsTrigger value="blocks" className="h-10 flex-shrink-0 px-3 md:px-3">
              Blocks
            </TabsTrigger>
            <TabsTrigger value="deposits" className="h-10 flex-shrink-0 px-3 md:px-3">
              Deposits
            </TabsTrigger>
            <TabsTrigger value="withdrawals" className="h-10 flex-shrink-0 px-3 md:px-3">
              Withdrawals
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="incidents" className="space-y-2 mt-4 min-h-[400px]">
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
        </TabsContent>

        <TabsContent value="consolidations" className="space-y-2 mt-4 min-h-[400px]">
          {consolidations.length > 0 ? (
            consolidations.map((event) => (
              <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No consolidations</p>
          )}
        </TabsContent>

        <TabsContent value="blocks" className="space-y-2 mt-4 min-h-[400px]">
          {blocks.length > 0 ? (
            blocks.map((event) => <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No blocks proposed</p>
          )}
        </TabsContent>

        <TabsContent value="deposits" className="space-y-2 mt-4 min-h-[400px]">
          {deposits.length > 0 ? (
            deposits.map((event) => <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No deposits</p>
          )}
        </TabsContent>

        <TabsContent value="withdrawals" className="space-y-2 mt-4 min-h-[400px]">
          {withdrawals.length > 0 ? (
            withdrawals.map((event) => (
              <EventItem key={event.id} event={event} gnoPrice={gnoPrice} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No withdrawals</p>
          )}
        </TabsContent>
      </Tabs>
    </DashboardCard>
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
