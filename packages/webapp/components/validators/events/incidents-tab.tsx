'use client';

import { useEffect, useState } from 'react';

import { EmptyStateTab } from './empty-state-tab';
import { EventsTabPagination } from './events-tab-pagination';

import ArrowRight from '@/components/icons/arrow-right';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { env } from '@/env';
import { useChainStats } from '@/hooks/use-chain-stats';
import type { ClusterIncident } from '@/hooks/use-cluster-incidents';
import { useClusterIncidents } from '@/hooks/use-cluster-incidents';
import { useIncidentAffectedValidators } from '@/hooks/use-incident-affected-validators';
import {
  cn,
  formatIncidentDateTime,
  formatIncidentDuration,
  formatIncidentDurationCompact,
  formatNumber,
  getTokenSymbol,
} from '@/lib/utils';

interface IncidentsTabProps {
  clusterId: string | null;
  isActive: boolean;
}

interface IncidentItemProps {
  incident: ClusterIncident;
  tokenPrice: number;
  tokenSymbol: string;
}

interface IncidentSummaryProps {
  incident: ClusterIncident;
  tokenPrice: number;
}

interface IncidentDetailsProps {
  incident: ClusterIncident;
  isLoading: boolean;
  errorMessage?: string;
  tokenPrice: number;
  tokenSymbol: string;
  validatorsAffected?: number;
}

interface IncidentRewardsProps {
  incident: ClusterIncident;
  tokenPrice: number;
  tokenSymbol: string;
}

interface AffectedValidatorsCountProps {
  isLoading: boolean;
  errorMessage?: string;
  validatorsAffected?: number;
}

/** Renders lazy-loaded cluster incidents with pagination. */
export function IncidentsTab({ clusterId, isActive }: IncidentsTabProps) {
  const [incidentsPage, setIncidentsPage] = useState(1);
  const { data: chainStats } = useChainStats();
  const {
    data: incidentsData,
    isLoading,
    error,
  } = useClusterIncidents(clusterId, incidentsPage, isActive);
  const totalIncidentPages = incidentsData
    ? Math.ceil(incidentsData.totalCount / incidentsData.pageSize)
    : 0;
  const tokenPrice = chainStats?.tokenPrice ?? 0;
  const tokenSymbol = getTokenSymbol(env.NEXT_PUBLIC_CHAIN);

  useEffect(() => {
    // Reset pagination when the selected cluster changes.
    setIncidentsPage(1);
  }, [clusterId]);

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

  if (!incidentsData || incidentsData.incidents.length === 0) {
    return <EmptyStateTab message="No incidents" />;
  }

  return (
    <div className="space-y-2">
      {incidentsData.incidents.map((incident) => (
        <IncidentItem
          key={incident.id}
          incident={incident}
          tokenPrice={tokenPrice}
          tokenSymbol={tokenSymbol}
        />
      ))}
      {totalIncidentPages > 1 && (
        <EventsTabPagination
          currentPage={incidentsPage}
          totalPages={totalIncidentPages}
          onPreviousPage={() => setIncidentsPage((page) => Math.max(1, page - 1))}
          onNextPage={() => setIncidentsPage((page) => Math.min(totalIncidentPages, page + 1))}
        />
      )}
    </div>
  );
}

/** Renders one incident row and lazy-loads affected validators when opened. */
function IncidentItem({ incident, tokenPrice, tokenSymbol }: IncidentItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const {
    data: validatorsData,
    isLoading,
    error,
  } = useIncidentAffectedValidators(incident.id, 1, isOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <IncidentSummary incident={incident} tokenPrice={tokenPrice} />

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
        <div className="px-3 py-3 ml-6 md:ml-11 space-y-3 text-sm border-l-2 border-border">
          <IncidentDetails
            incident={incident}
            isLoading={isLoading}
            errorMessage={error?.message}
            tokenPrice={tokenPrice}
            tokenSymbol={tokenSymbol}
            validatorsAffected={validatorsData?.totalCount}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Renders the collapsed incident summary with clearer hierarchy. */
function IncidentSummary({ incident, tokenPrice }: IncidentSummaryProps) {
  const costUsd = getIncidentCostUsd(incident, tokenPrice);

  return (
    <div className="flex-1 min-w-0">
      <div className="grid grid-cols-[minmax(0,1.3fr)_auto] gap-3 items-start">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
          <div className="min-w-0 rounded-md border border-border/60 bg-background/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Opened</div>
            <div className="text-xs md:text-sm font-mono text-foreground truncate">
              {formatIncidentDateTime(incident.openedAt)}
            </div>
          </div>

          <div className="rounded-md border border-border/60 bg-background/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Status
            </div>
            <Badge variant={incident.status === 'open' ? 'outline-warning' : 'outline-success'}>
              {incident.status}
            </Badge>
          </div>

          <div className="rounded-md border border-border/60 bg-background/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Duration
            </div>
            <div className="text-xs md:text-sm font-mono text-foreground">
              {formatIncidentDurationCompact(incident)}
            </div>
          </div>
        </div>

        {costUsd && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost</div>
            <div className="text-sm md:text-base font-mono text-destructive">${costUsd}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders static incident metadata. */
function IncidentDetails({
  incident,
  isLoading,
  errorMessage,
  tokenPrice,
  tokenSymbol,
  validatorsAffected,
}: IncidentDetailsProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Open</span>
        <span className="font-mono text-xs break-all">
          {formatIncidentDateTime(incident.openedAt)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Close</span>
        <span className="font-mono text-xs break-all">
          {incident.closedAt ? formatIncidentDateTime(incident.closedAt) : '-'}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Duration</span>
        <span className="font-mono text-xs md:text-sm">{formatIncidentDuration(incident)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Open Slot</span>
        <span className="font-mono text-xs md:text-sm">{incident.openedSlot.toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Close Slot</span>
        <span className="font-mono text-xs md:text-sm">
          {incident.closedSlot !== null ? incident.closedSlot.toLocaleString() : '-'}
        </span>
      </div>
      <IncidentRewards incident={incident} tokenPrice={tokenPrice} tokenSymbol={tokenSymbol} />
      <AffectedValidatorsCount
        isLoading={isLoading}
        errorMessage={errorMessage}
        validatorsAffected={validatorsAffected}
      />
    </div>
  );
}

/** Renders the incident missed rewards state and value. */
function IncidentRewards({ incident, tokenPrice, tokenSymbol }: IncidentRewardsProps) {
  if (!incident.rewardsFinalized) {
    return (
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Missed Rewards</span>
        <span className="text-xs md:text-sm text-muted-foreground">
          Rewards are still processing
        </span>
      </div>
    );
  }

  if (incident.missedConsensusRewards === null) {
    return (
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Missed Rewards</span>
        <span className="text-xs md:text-sm text-muted-foreground">No missed rewards recorded</span>
      </div>
    );
  }

  const missedRewards = Number(incident.missedConsensusRewards);
  const hasTokenPrice = Number.isFinite(tokenPrice) && tokenPrice > 0;
  const missedRewardsUsd = hasTokenPrice ? ` ($${formatNumber(missedRewards * tokenPrice)})` : '';

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground text-xs md:text-sm">Missed Rewards</span>
      <span className="font-normal text-destructive text-xs md:text-sm text-right">
        {incident.missedConsensusRewards} {tokenSymbol}
        {missedRewardsUsd}
      </span>
    </div>
  );
}

/** Renders the lazy-loaded affected validators count. */
function AffectedValidatorsCount({
  isLoading,
  errorMessage,
  validatorsAffected,
}: AffectedValidatorsCountProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Validators Affected</span>
        <span className="text-xs md:text-sm text-muted-foreground">
          Loading affected validators...
        </span>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Validators Affected</span>
        <span className="text-xs md:text-sm text-destructive">{errorMessage}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground text-xs md:text-sm">Validators Affected</span>
      <span className="font-mono text-xs md:text-sm">
        {validatorsAffected !== undefined ? validatorsAffected.toLocaleString() : '-'}
      </span>
    </div>
  );
}

/** Returns the incident cost in USD when rewards and price are available. */
function getIncidentCostUsd(incident: ClusterIncident, tokenPrice: number): string | null {
  if (!incident.rewardsFinalized || incident.missedConsensusRewards === null || tokenPrice <= 0) {
    return null;
  }

  return formatNumber(Number(incident.missedConsensusRewards) * tokenPrice);
}
