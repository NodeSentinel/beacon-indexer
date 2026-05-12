/** Formats a block proposal timestamp for collapsed block rows. */
export function formatBlockProposalDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
