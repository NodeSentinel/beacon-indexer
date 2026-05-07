'use client';

import { Button } from '@/components/ui/button';

interface EventsTabPaginationProps {
  currentPage: number;
  totalPages: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

/** Renders the shared pager used by event tabs. */
export function EventsTabPagination({
  currentPage,
  onNextPage,
  onPreviousPage,
  totalPages,
}: EventsTabPaginationProps) {
  return (
    <div className="flex items-center justify-between pt-3 border-t border-border/50">
      <Button variant="ghost" size="sm" onClick={onPreviousPage} disabled={currentPage <= 1}>
        Prev
      </Button>
      <span className="text-xs text-muted-foreground">
        Page {currentPage} of {totalPages}
      </span>
      <Button variant="ghost" size="sm" onClick={onNextPage} disabled={currentPage >= totalPages}>
        Next
      </Button>
    </div>
  );
}
