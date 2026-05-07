'use client';

/** Renders a shared empty state for tabs without records. */
export function EmptyStateTab({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{message}</p>;
}
