'use client';

import { ChevronDown, ChevronUp, Eye, EyeOff, Gift, Target } from 'lucide-react';
import { useMemo, useState } from 'react';

import DashboardCard from '@/components/dashboard/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { env } from '@/env';
import { formatNumber, getTokenSymbol, REWARD_UNIT, weiToETH, weiToGwei } from '@/lib/utils';

interface Attestation {
  indexInEpoch: number;
  aggregationBitsIndex: number;
  delay: number | null;
}

interface BlockRewards {
  blockReward: string | null;
}

interface SyncRewards {
  syncCommittee: string | null;
}

interface Slot {
  slot: number;
  attestation: Attestation;
  blockRewards: BlockRewards;
  syncRewards: SyncRewards;
}

interface EpochRewards {
  head: string;
  target: string;
  source: string;
  inactivity: string;
  missedHead: string;
  missedTarget: string;
  missedSource: string;
  missedInactivity: string;
}

interface Epoch {
  epoch: number;
  rewards: EpochRewards;
  slot: Slot | null;
}

interface ValidatorRewardsListProps {
  epochs: Epoch[];
}

function getTotalRewards(rewards: EpochRewards): number {
  return (
    Number(rewards.head) +
    Number(rewards.target) +
    Number(rewards.source) +
    Number(rewards.inactivity)
  );
}

const ITEMS_PER_PAGE = 20;

export default function ValidatorRewardsList({ epochs }: ValidatorRewardsListProps) {
  const [expandedEpochs, setExpandedEpochs] = useState<Set<number>>(new Set());
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);

  const sortedEpochs = useMemo(() => [...epochs].sort((a, b) => b.epoch - a.epoch), [epochs]);

  const displayedEpochs = sortedEpochs.slice(0, displayCount);
  const hasMore = displayCount < sortedEpochs.length;

  const toggleEpoch = (epoch: number) => {
    setExpandedEpochs((prev) => {
      const next = new Set(prev);
      if (next.has(epoch)) {
        next.delete(epoch);
      } else {
        next.add(epoch);
      }
      return next;
    });
  };

  const loadMore = () => {
    setDisplayCount((prev) => Math.min(prev + ITEMS_PER_PAGE, sortedEpochs.length));
  };

  return (
    <DashboardCard
      title={
        <div className="flex items-center gap-2">
          <span>Attestations and Rewards</span>
        </div>
      }
    >
      <div className="space-y-2">
        {displayedEpochs.map((epochData) => (
          <EpochRow
            key={epochData.epoch}
            epoch={epochData}
            isExpanded={expandedEpochs.has(epochData.epoch)}
            onToggle={() => toggleEpoch(epochData.epoch)}
          />
        ))}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" onClick={loadMore} className="w-full md:w-auto">
              Load More
            </Button>
          </div>
        )}

        {epochs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Gift className="size-8 mx-auto mb-2 opacity-50" />
            <p>No reward data available</p>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}

interface EpochRowProps {
  epoch: Epoch;
  isExpanded: boolean;
  onToggle: () => void;
}

function EpochRow({ epoch, isExpanded, onToggle }: EpochRowProps) {
  const totalRewards = getTotalRewards(epoch.rewards);
  const hasSlot = epoch.slot !== null;
  const hasBlockReward = epoch.slot?.blockRewards.blockReward !== null;
  const hasSyncReward = epoch.slot?.syncRewards.syncCommittee !== null;
  const attestationDelay = epoch.slot?.attestation.delay;

  const isPositive = totalRewards > 0;
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="border border-border/50 rounded-lg overflow-hidden hover:border-border transition-colors">
        {/* Main Row - Compact Summary */}
        <CollapsibleTrigger asChild>
          <button className="w-full p-2.5 md:p-3 text-left hover:bg-muted/30 transition-colors">
            {/* Mobile Layout: 2 rows */}
            <div className="flex flex-col gap-2 md:hidden">
              {/* Row 1: Epoch, Slot */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Epoch</span>
                  <span className="text-sm">{formatNumber(epoch.epoch)}</span>
                </div>
                {hasSlot && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">Slot</span>
                    <span className="font-mono text-xs">{formatNumber(epoch.slot!.slot)}</span>
                  </div>
                )}
              </div>
              {/* Row 2: attestation indicators (left), rewards (right) */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  {hasSlot &&
                    (attestationDelay === null || attestationDelay === undefined ? (
                      <span className="flex items-center gap-1 text-[10px] text-destructive">
                        <EyeOff className="size-3" />
                        missed
                      </span>
                    ) : attestationDelay <= 1 ? (
                      <span className="flex items-center gap-1 text-[10px] text-success">
                        <Eye className="size-3" />
                        on time
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-warning">
                        <Eye className="size-3" />+{attestationDelay}
                      </span>
                    ))}
                  {hasBlockReward && (
                    <span className="flex items-center gap-1 text-[10px] text-success">
                      <Gift className="size-2.5" />
                      Block
                    </span>
                  )}
                  {hasSyncReward && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Target className="size-2.5" />
                      Sync
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`text-sm normal-case ${isPositive ? 'text-success' : 'text-muted-foreground'}`}
                  >
                    <span>
                      {isPositive ? '+' : ''}
                      {formatNumber(weiToGwei(totalRewards))} {REWARD_UNIT}
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </div>

            {/* Desktop Layout: Single row */}
            <div className="hidden md:flex items-center gap-3">
              <div className="flex items-center gap-2 min-w-[100px]">
                <span className="text-xs text-muted-foreground">Epoch</span>
                <span>{formatNumber(epoch.epoch)}</span>
              </div>

              {hasSlot && (
                <div className="flex items-center gap-2 min-w-[100px]">
                  <span className="text-xs text-muted-foreground">Slot</span>
                  <span className="font-mono text-sm">{formatNumber(epoch.slot!.slot)}</span>
                </div>
              )}

              {/* Rewards Summary */}
              <div className="flex-1 flex items-center gap-3 justify-end">
                {/* Attestation Delay */}
                {hasSlot &&
                  (attestationDelay === null || attestationDelay === undefined ? (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <EyeOff className="size-3.5" />
                      missed
                    </span>
                  ) : attestationDelay <= 1 ? (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <Eye className="size-3.5" />
                      on time
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-warning">
                      <Eye className="size-3.5" />+{attestationDelay}
                    </span>
                  ))}

                {/* Block Proposer */}
                {hasBlockReward && (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Gift className="size-3" />
                    Block
                  </span>
                )}

                {/* Sync Committee */}
                {hasSyncReward && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Target className="size-3" />
                    Sync
                  </span>
                )}

                {/* Total Reward (GWei only) */}
                <div
                  className={`text-right min-w-[80px] normal-case ${isPositive ? 'text-success' : 'text-muted-foreground'}`}
                >
                  <span>
                    {isPositive ? '+' : ''}
                    {formatNumber(weiToGwei(totalRewards))} {REWARD_UNIT}
                  </span>
                </div>

                {isExpanded ? (
                  <ChevronUp className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </button>
        </CollapsibleTrigger>

        {/* Expanded Details — account-style: additions, subtractions, total */}
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-1 border-t border-border/50 bg-muted/20">
            <RewardAccountStatement
              rewards={epoch.rewards}
              slot={epoch.slot}
              tokenSymbol={getTokenSymbol(env.NEXT_PUBLIC_CHAIN)}
            />

            {/* Slot metadata (index, aggregation bit) */}
            {/* {hasSlot && (
              <div className="mt-3 pt-3 border-t border-border/30 flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>Attestation index: <span className="font-mono text-foreground">{epoch.slot!.attestation.indexInEpoch}</span></span>
                <span>Aggregation bit: <span className="font-mono text-foreground">{epoch.slot!.attestation.aggregationBitsIndex}</span></span>
              </div>
            )} */}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface RewardAccountStatementProps {
  rewards: EpochRewards;
  slot: Slot | null;
  tokenSymbol: string;
}

function RewardAccountStatement({ rewards, slot, tokenSymbol }: RewardAccountStatementProps) {
  const additions: { label: string; wei: number }[] = [];
  const subtractions: { label: string; wei: number }[] = [];

  const push = (label: string, value: string, list: { label: string; wei: number }[]) => {
    const wei = Number(value);
    if (wei > 0) list.push({ label, wei });
  };

  push('Head', rewards.head, additions);
  push('Target', rewards.target, additions);
  push('Source', rewards.source, additions);
  push('Inactivity', rewards.inactivity, additions);

  push('Missed head', rewards.missedHead, subtractions);
  push('Missed target', rewards.missedTarget, subtractions);
  push('Missed source', rewards.missedSource, subtractions);
  push('Missed inactivity', rewards.missedInactivity, subtractions);

  if (slot?.syncRewards.syncCommittee) {
    const syncWei = Number(slot.syncRewards.syncCommittee);
    if (syncWei > 0) additions.push({ label: 'Sync committee', wei: syncWei });
  }
  if (slot?.blockRewards.blockReward) {
    const blockWei = Number(slot.blockRewards.blockReward);
    if (blockWei > 0) additions.push({ label: 'Block', wei: blockWei });
  }

  const totalGained = additions.reduce((s, x) => s + x.wei, 0);
  const totalLost = subtractions.reduce((s, x) => s + x.wei, 0);
  const netWei = totalGained - totalLost;
  const netGwei = weiToGwei(Math.abs(netWei));
  const netToken = weiToETH(Math.abs(netWei));

  return (
    <div className="text-sm font-mono space-y-0.5">
      {additions.map(({ label, wei }) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="text-success tabular-nums">
            +{formatNumber(weiToGwei(wei))} {REWARD_UNIT}
          </span>
        </div>
      ))}
      {subtractions.map(({ label, wei }) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="text-destructive tabular-nums">
            -{formatNumber(weiToGwei(wei))} {REWARD_UNIT}
          </span>
        </div>
      ))}
      <div className="flex justify-between gap-4 pt-2 mt-2 border-t border-border/50 font-medium">
        <span>Total</span>
        <span className={`tabular-nums ${netWei >= 0 ? 'text-success' : 'text-destructive'}`}>
          {netWei >= 0 ? '+' : '-'}
          {formatNumber(netGwei)} {REWARD_UNIT}
          <span className="text-muted-foreground font-normal ml-1 text-xs">
            ({netWei >= 0 ? '+' : '-'}
            {formatNumber(netToken, 5)} {tokenSymbol})
          </span>
        </span>
      </div>
    </div>
  );
}
