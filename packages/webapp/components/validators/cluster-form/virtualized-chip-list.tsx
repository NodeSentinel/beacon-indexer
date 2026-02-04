'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState, useEffect } from 'react';

import { ValidatorChip } from './validator-chip';

import type { ValidatorItem } from '@/hooks/use-validator-input';

// Approximate chips per row based on average chip width (~70px) + gap (6px)
const APPROX_CHIP_WIDTH = 76;
const ROW_HEIGHT = 24;

interface VirtualizedChipListProps {
  validators: ValidatorItem[];
  onRemoveValidator: (id: string) => void;
  maxHeight: number;
}

export function VirtualizedChipList({
  validators,
  onRemoveValidator,
  maxHeight,
}: VirtualizedChipListProps) {
  const parentRef = useRef<HTMLDivElement>(null!);
  const [containerWidth, setContainerWidth] = useState(300);

  // Measure container width
  useEffect(() => {
    if (!parentRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(parentRef.current);
    return () => observer.disconnect();
  }, []);

  // For small lists, don't virtualize
  if (validators.length <= 50) {
    return (
      <div ref={parentRef} className="max-h-32 overflow-y-auto pr-2" style={{ maxHeight }}>
        <div className="flex flex-wrap gap-1.5">
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

  const chipsPerRow = Math.max(1, Math.floor(containerWidth / APPROX_CHIP_WIDTH));

  // Group validators into rows
  const rows: ValidatorItem[][] = [];
  for (let i = 0; i < validators.length; i += chipsPerRow) {
    rows.push(validators.slice(i, i + chipsPerRow));
  }

  return (
    <VirtualizedListInner
      rows={rows}
      maxHeight={maxHeight}
      onRemoveValidator={onRemoveValidator}
      parentRef={parentRef}
    />
  );
}

function VirtualizedListInner({
  rows,
  maxHeight,
  onRemoveValidator,
  parentRef,
}: {
  rows: ValidatorItem[][];
  maxHeight: number;
  onRemoveValidator: (id: string) => void;
  parentRef: React.RefObject<HTMLDivElement>;
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className="overflow-y-auto pr-2" style={{ maxHeight }}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {items.map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="flex flex-wrap gap-1.5"
            >
              {row.map((validator) => (
                <ValidatorChip
                  key={validator.id}
                  index={validator.index}
                  onRemove={() => onRemoveValidator(validator.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
