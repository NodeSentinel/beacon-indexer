'use client';

import { Button } from '@/components/ui/button';

interface EventsTabPaginationProps {
  currentPage: number;
  hasNextPage?: boolean;
  totalPages?: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

/** Renders the shared pager used by event tabs. */
export function EventsTabPagination({
  currentPage,
  hasNextPage,
  onNextPage,
  onPreviousPage,
  totalPages,
}: EventsTabPaginationProps) {
  const canGoNext = totalPages !== undefined ? currentPage < totalPages : Boolean(hasNextPage);

  return (
    <div className="flex items-center justify-between pt-3 border-t border-border/50">
      <Button variant="ghost" size="sm" onClick={onPreviousPage} disabled={currentPage <= 1}>
        Prev
      </Button>
      <span className="text-xs text-muted-foreground">
        {totalPages !== undefined ? `Page ${currentPage} of ${totalPages}` : `Page ${currentPage}`}
      </span>
      <Button variant="ghost" size="sm" onClick={onNextPage} disabled={!canGoNext}>
        Next
      </Button>
    </div>
  );
}
