'use client';

import Image from 'next/image';

import { Button } from '@/components/ui/button';

interface LidoCsmOperatorCardProps {
  missingCount: number;
  onAddMissing: () => void;
  operatorId: string;
  validatorCount: number;
}

/** Renders the stored Lido CSM operator and missing validator action. */
export function LidoCsmOperatorCard({
  missingCount,
  onAddMissing,
  operatorId,
  validatorCount,
}: LidoCsmOperatorCardProps) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/50">
        <Image
          src="/assets/lido-csm.svg"
          alt=""
          width={20}
          height={20}
          className="size-5"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-medium text-muted-foreground block">
            Lido CSM operator {operatorId}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {validatorCount} validator{validatorCount !== 1 ? 's' : ''} in cluster
          </span>
        </div>
      </div>

      {missingCount > 0 && (
        <div className="p-2">
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
        </div>
      )}
    </div>
  );
}
