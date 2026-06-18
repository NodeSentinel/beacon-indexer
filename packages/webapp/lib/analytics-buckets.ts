export type AnalyticsTimeRange = '1h' | '24h';

interface BucketConfig {
  bucketMs: number;
  totalMs: number;
  bucketCount: number;
}

export function getBucketConfig(timeRange: AnalyticsTimeRange): BucketConfig {
  const bucketMs = timeRange === '1h' ? 5 * 60 * 1000 : 60 * 60 * 1000;
  const totalMs = timeRange === '1h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return { bucketMs, totalMs, bucketCount: totalMs / bucketMs };
}

export function getAlignedStart(now: number, config: BucketConfig): number {
  return Math.floor((now - config.totalMs) / config.bucketMs) * config.bucketMs;
}

export function getBucketIndex(ts: number, start: number, config: BucketConfig): number | null {
  if (ts < start) return null;
  const idx = Math.floor((ts - start) / config.bucketMs);
  if (idx >= config.bucketCount) return null;
  return idx;
}

export function formatBucketTime(start: number, index: number, bucketMs: number): string {
  return new Date(start + index * bucketMs).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Generic bucketing: distributes timestamped items into fixed-width time buckets.
 * `aggregate` merges an item into the accumulator for its bucket.
 * `finalize` converts the accumulator (or null for empty buckets) into the output shape.
 */
export function bucketByTime<TItem, TAcc, TOut>(
  items: TItem[],
  timeRange: AnalyticsTimeRange,
  getTimestamp: (item: TItem) => number,
  aggregate: (acc: TAcc | undefined, item: TItem) => TAcc,
  finalize: (acc: TAcc | undefined, time: string) => TOut,
): TOut[] {
  const now = Date.now();
  const config = getBucketConfig(timeRange);
  const start = getAlignedStart(now, config);

  const byBucket = new Map<number, TAcc>();
  for (const item of items) {
    const idx = getBucketIndex(getTimestamp(item), start, config);
    if (idx === null) continue;
    byBucket.set(idx, aggregate(byBucket.get(idx), item));
  }

  return Array.from({ length: config.bucketCount }, (_, i) => {
    const time = formatBucketTime(start, i, config.bucketMs);
    return finalize(byBucket.get(i), time);
  });
}
