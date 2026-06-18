'use client';

import { Hash, X } from 'lucide-react';

import type { ValidatorItem } from '@/hooks/use-validator-input';

interface ValidatorChipProps {
  validator: ValidatorItem;
  onRemove: () => void;
}

/** Renders a removable selected validator chip. */
export function ValidatorChip({ onRemove, validator }: ValidatorChipProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm font-bold transition-colors group hover:bg-muted/80">
      <Hash className="size-4" />
      <span>{validator.index}</span>
      <button
        type="button"
        tabIndex={-1}
        onClick={onRemove}
        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
