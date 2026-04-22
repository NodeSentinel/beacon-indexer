'use client';

import { useEffect, useState } from 'react';

import ArrowRight from '@/components/icons/arrow-right';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  UnderlineTabs,
  UnderlineTabsContent,
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from '@/components/underline-tabs';
import { env } from '@/env';
import { useBlockProposals } from '@/hooks/use-block-proposals';
import { useChainStats } from '@/hooks/use-chain-stats';
import type { ClusterIncident } from '@/hooks/use-cluster-incidents';
import { useClusterIncidents } from '@/hooks/use-cluster-incidents';
import { useIncidentAffectedValidators } from '@/hooks/use-incident-affected-validators';
import {
  cn,
  formatIncidentDateTime,
  formatIncidentDuration,
  formatNumber,
  getTokenSymbol,
} from '@/lib/utils';

interface EventsFeedContentProps {
  clusterId: string | null;
}

export default function EventsFeedContent({ clusterId }: EventsFeedContentProps) {
  const [activeTab, setActiveTab] = useState('blocks');

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs md:text-sm text-primary uppercase tracking-wider shrink-0">
          Events
        </span>
        <div className="flex-1 h-px bg-primary/20" />
      </div>
      <UnderlineTabs defaultValue="blocks" value={activeTab} onValueChange={setActiveTab}>
        <UnderlineTabsList>
          <UnderlineTabsTrigger value="blocks">Blocks</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="incidents">Incidents</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="consolidations">Consolidations</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="deposits">Deposits</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="withdrawals">Withdrawals</UnderlineTabsTrigger>
        </UnderlineTabsList>

        <UnderlineTabsContent value="blocks" className="space-y-2 mt-4 min-h-[400px]">
          <BlocksTab clusterId={clusterId} />
        </UnderlineTabsContent>

        <UnderlineTabsContent value="incidents" className="space-y-2 mt-4 min-h-[400px]">
          <IncidentsTab clusterId={clusterId} isActive={activeTab === 'incidents'} />
        </UnderlineTabsContent>

        <UnderlineTabsContent value="consolidations" className="space-y-2 mt-4 min-h-[400px]">
          <p className="text-sm text-muted-foreground text-center py-8">No consolidations</p>
        </UnderlineTabsContent>

        <UnderlineTabsContent value="deposits" className="space-y-2 mt-4 min-h-[400px]">
          <p className="text-sm text-muted-foreground text-center py-8">No deposits</p>
        </UnderlineTabsContent>

        <UnderlineTabsContent value="withdrawals" className="space-y-2 mt-4 min-h-[400px]">
          <p className="text-sm text-muted-foreground text-center py-8">No withdrawals</p>
        </UnderlineTabsContent>
      </UnderlineTabs>
    </div>
  );
}

// --- Blocks Tab ---

function BlocksTab({ clusterId }: { clusterId: string | null }) {
  const [blocksPage, setBlocksPage] = useState(1);
  const { data: blocksData, isLoading } = useBlockProposals(
    clusterId ? { clusterId } : null,
    blocksPage,
  );

  const totalBlockPages = blocksData ? Math.ceil(blocksData.totalCount / blocksData.pageSize) : 0;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-foreground/5 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!blocksData || blocksData.blocks.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No blocks proposed</p>;
  }

  return (
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
  );
}

// --- Incidents Tab ---

/** Renders lazy-loaded cluster incidents with pagination. */
function IncidentsTab({ clusterId, isActive }: { clusterId: string | null; isActive: boolean }) {
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
    // Resets incident pagination when the selected cluster changes.
    setIncidentsPage(1);
  }, [clusterId]);

  if (!clusterId) {
    return <p className="text-sm text-muted-foreground text-center py-8">Select a cluster</p>;
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-foreground/5 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive text-center py-8">{error.message}</p>;
  }

  if (!incidentsData || incidentsData.incidents.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No incidents</p>;
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
        <div className="flex items-center justify-between pt-3 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIncidentsPage((p) => Math.max(1, p - 1))}
            disabled={incidentsPage <= 1}
          >
            Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {incidentsPage} of {totalIncidentPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIncidentsPage((p) => Math.min(totalIncidentPages, p + 1))}
            disabled={incidentsPage >= totalIncidentPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Incident Item ---

/** Renders one incident row and lazy-loads affected validators when opened. */
function IncidentItem({
  incident,
  tokenPrice,
  tokenSymbol,
}: {
  incident: ClusterIncident;
  tokenPrice: number;
  tokenSymbol: string;
}) {
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
          <div className="flex-1 grid grid-cols-[auto_auto_1fr] items-center gap-2 text-left min-w-0">
            <span className="text-xs md:text-sm font-mono text-muted-foreground whitespace-nowrap">
              {formatIncidentDateTime(incident.openedAt)}
            </span>
            <span className="text-xs md:text-sm font-mono text-muted-foreground whitespace-nowrap capitalize">
              {incident.status}
            </span>
            <span className="text-xs md:text-sm text-muted-foreground truncate">
              {formatIncidentDuration(incident)}
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

/** Renders static incident metadata. */
function IncidentDetails({
  incident,
  isLoading,
  errorMessage,
  tokenPrice,
  tokenSymbol,
  validatorsAffected,
}: {
  incident: ClusterIncident;
  isLoading: boolean;
  errorMessage?: string;
  tokenPrice: number;
  tokenSymbol: string;
  validatorsAffected?: number;
}) {
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
function IncidentRewards({
  incident,
  tokenPrice,
  tokenSymbol,
}: {
  incident: ClusterIncident;
  tokenPrice: number;
  tokenSymbol: string;
}) {
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
}: {
  isLoading: boolean;
  errorMessage?: string;
  validatorsAffected?: number;
}) {
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

// --- Block Item ---

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
        <div className="flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <div className="flex-1 flex items-center gap-2 text-left min-w-0">
            <span className="text-xs md:text-sm font-mono text-muted-foreground whitespace-nowrap">
              Val #{block.validatorIndex}
            </span>
            <span className="text-xs md:text-sm font-mono whitespace-nowrap">
              Slot #{block.slot.toLocaleString()}
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
              <span className="font-normal text-success text-xs md:text-sm">
                {block.consensusReward} GNO
              </span>
            </div>
          )}
          {block.executionReward && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-xs md:text-sm">Execution Reward</span>
              <span className="font-normal text-success text-xs md:text-sm">
                {block.executionReward}
              </span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
