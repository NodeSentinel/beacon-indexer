'use client';

import { Trash2 } from 'lucide-react';

import { VirtualizedChipList } from './virtualized-chip-list';

import { Button } from '@/components/ui/button';
import type { ValidatorItem } from '@/hooks/use-validator-input';

interface WithdrawalAddressCardProps {
  address: string;
  validators: ValidatorItem[];
  totalCount: number;
  missingCount: number;
  onRemoveAddress: () => void;
  onRemoveValidator: (id: string) => void;
  onAddMissing: () => void;
}

export function WithdrawalAddressCard({
  address,
  validators,
  totalCount,
  missingCount,
  onRemoveAddress,
  onRemoveValidator,
  onAddMissing,
}: WithdrawalAddressCardProps) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/50 group">
        <div className="flex-1 min-w-0">
          <span className="font-mono text-xs truncate block">{address}</span>
          <span className="text-[10px] text-muted-foreground">
            {validators.length} of {totalCount} validators
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemoveAddress}
          className="shrink-0 size-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-50 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="p-2 space-y-2">
        {/* Missing validators banner */}
        {missingCount > 0 && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-warning/10 text-warning">
            <span className="text-xs flex-1">
              {missingCount} more validator{missingCount > 1 ? 's' : ''} available
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onAddMissing}
              className="h-6 px-2 text-xs text-warning hover:text-warning hover:bg-warning/20"
            >
              Add all
            </Button>
          </div>
        )}

        {/* Validators list */}
        {validators.length > 0 && (
          <VirtualizedChipList
            validators={validators}
            onRemoveValidator={onRemoveValidator}
            maxHeight={128}
          />
        )}
      </div>
    </div>
  );
}
