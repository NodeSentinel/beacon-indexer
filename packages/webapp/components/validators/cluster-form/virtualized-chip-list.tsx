'use client';

import { ValidatorChip } from './validator-chip';

import type { ValidatorItem } from '@/hooks/use-validator-input';

interface ChipListProps {
  validators: ValidatorItem[];
  onRemoveValidator: (id: string) => void;
  maxHeight: number;
}

export function VirtualizedChipList({ maxHeight, onRemoveValidator, validators }: ChipListProps) {
  return (
    <div className="overflow-y-auto pr-2" style={{ maxHeight }}>
      <div
        className="flex flex-wrap gap-1.5"
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }}
      >
        {validators.map((validator) => (
          <ValidatorChip
            key={validator.id}
            index={validator.index}
            onRemove={() => onRemoveValidator(validator.id)}
          />
        ))}
      </div>
    </div>
  );
}
