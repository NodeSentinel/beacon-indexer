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
import { useBlockProposals } from '@/hooks/use-block-proposals';
import type { ClusterIncident } from '@/hooks/use-cluster-incidents';
import { useClusterIncidents } from '@/hooks/use-cluster-incidents';
import type { IncidentAffectedValidator } from '@/hooks/use-incident-affected-validators';
import { useIncidentAffectedValidators } from '@/hooks/use-incident-affected-validators';
import { cn } from '@/lib/utils';

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
  const {
    data: incidentsData,
    isLoading,
    error,
  } = useClusterIncidents(clusterId, incidentsPage, isActive);

  const totalIncidentPages = incidentsData
    ? Math.ceil(incidentsData.totalCount / incidentsData.pageSize)
    : 0;

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
        <IncidentItem key={incident.id} incident={incident} />
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
function IncidentItem({ incident }: { incident: ClusterIncident }) {
  const [isOpen, setIsOpen] = useState(false);
  const [validatorsPage, setValidatorsPage] = useState(1);
  const {
    data: validatorsData,
    isLoading,
    error,
  } = useIncidentAffectedValidators(incident.id, validatorsPage, isOpen);

  const totalValidatorPages = validatorsData
    ? Math.ceil(validatorsData.totalCount / validatorsData.pageSize)
    : 0;

  const durationLabel =
    incident.durationSlots !== null ? `${incident.durationSlots.toLocaleString()} slots` : 'Open';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors group cursor-pointer border border-border/50 hover:border-border">
          <div className="flex-1 flex items-center gap-2 text-left min-w-0">
            <span className="text-xs md:text-sm font-mono text-muted-foreground whitespace-nowrap capitalize">
              {incident.status}
            </span>
            <span className="text-xs md:text-sm font-mono whitespace-nowrap">
              Slot #{incident.openedSlot.toLocaleString()}
            </span>
            <span className="text-xs md:text-sm text-muted-foreground truncate">
              {durationLabel}
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
          <IncidentDetails incident={incident} />
          <AffectedValidatorsSection
            validators={validatorsData?.validators ?? []}
            isLoading={isLoading}
            errorMessage={error?.message}
            totalPages={totalValidatorPages}
            currentPage={validatorsPage}
            onPreviousPage={() => setValidatorsPage((p) => Math.max(1, p - 1))}
            onNextPage={() => setValidatorsPage((p) => Math.min(totalValidatorPages, p + 1))}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Renders static incident metadata. */
function IncidentDetails({ incident }: { incident: ClusterIncident }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Opened</span>
        <span className="font-mono text-xs break-all">{incident.openedAt}</span>
      </div>
      {incident.closedAt && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-xs md:text-sm">Closed</span>
          <span className="font-mono text-xs break-all">{incident.closedAt}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground text-xs md:text-sm">Opened Slot</span>
        <span className="font-mono text-xs md:text-sm">{incident.openedSlot.toLocaleString()}</span>
      </div>
      {incident.closedSlot !== null && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-xs md:text-sm">Closed Slot</span>
          <span className="font-mono text-xs md:text-sm">
            {incident.closedSlot.toLocaleString()}
          </span>
        </div>
      )}
      {incident.missedConsensusRewards !== null && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-xs md:text-sm">Missed Consensus Rewards</span>
          <span className="font-normal text-destructive text-xs md:text-sm">
            {incident.missedConsensusRewards}
          </span>
        </div>
      )}
    </div>
  );
}

interface AffectedValidatorsSectionProps {
  validators: IncidentAffectedValidator[];
  isLoading: boolean;
  errorMessage?: string;
  totalPages: number;
  currentPage: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

/** Renders the lazy-loaded affected validators list. */
function AffectedValidatorsSection({
  validators,
  isLoading,
  errorMessage,
  totalPages,
  currentPage,
  onPreviousPage,
  onNextPage,
}: AffectedValidatorsSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Affected Validators
        </p>
        <div className="h-12 bg-foreground/5 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (errorMessage) {
    return <p className="text-sm text-destructive py-2">{errorMessage}</p>;
  }

  if (validators.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">No affected validators</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Affected Validators</p>
      <div className="space-y-1">
        {validators.map((validator) => (
          <AffectedValidatorItem key={validator.validatorIndex} validator={validator} />
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={onPreviousPage} disabled={currentPage <= 1}>
            Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onNextPage}
            disabled={currentPage >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/** Renders one affected validator row. */
function AffectedValidatorItem({ validator }: { validator: IncidentAffectedValidator }) {
  const slotRange =
    validator.inactiveToSlot !== null
      ? `${validator.inactiveFromSlot.toLocaleString()}-${validator.inactiveToSlot.toLocaleString()}`
      : `${validator.inactiveFromSlot.toLocaleString()}-open`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-background/60 border border-border/50 px-2 py-1.5">
      <span className="font-mono text-xs md:text-sm whitespace-nowrap">
        Val #{validator.validatorIndex}
      </span>
      <span className="font-mono text-xs text-muted-foreground truncate">Slots {slotRange}</span>
      <span className="font-normal text-destructive text-xs md:text-sm whitespace-nowrap">
        {validator.missedConsensusRewards}
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
