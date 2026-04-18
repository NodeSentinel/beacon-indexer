/**
 * Splits recipients into fixed-size batches for broadcast sends.
 */
export function splitRecipientsIntoBatches(recipients: string[], batchSize: number): string[][] {
  const batches: string[][] = [];

  // Slice the recipient list into contiguous groups that can be sent concurrently.
  for (let index = 0; index < recipients.length; index += batchSize) {
    batches.push(recipients.slice(index, index + batchSize));
  }

  return batches;
}

/**
 * Counts successful and failed deliveries from one settled batch.
 */
export function countBatchDeliveryResults(results: PromiseSettledResult<boolean>[]) {
  let sentCount = 0;
  let failedCount = 0;

  // Treat rejected sends as failed deliveries so one bad recipient does not abort the batch.
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      sentCount += 1;
      continue;
    }

    failedCount += 1;
  }

  return {
    failedCount,
    sentCount,
  };
}
