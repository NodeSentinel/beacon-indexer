'use client';

import { X } from 'lucide-react';

interface ValidatorChipProps {
  index: number;
  onRemove: () => void;
}

export function ValidatorChip({ index, onRemove }: ValidatorChipProps) {
  return (
    <div className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors group text-sm border border-primary/20">
      <span className="font-mono text-primary">{index}</span>
      <button
        type="button"
        onClick={onRemove}
        className="size-5 inline-flex items-center justify-center rounded text-primary/60 hover:text-destructive hover:bg-destructive/10 opacity-50 group-hover:opacity-100 transition-opacity"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
