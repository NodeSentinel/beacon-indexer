import type { ActionArgs, EventObject, MachineContext } from 'xstate';

// This action is shared by many XState machines. Passing this optional, non-critical
// log sink through every machine input/context would pollute their domain contracts.
const lokiUrl = process.env.LOKI_URL;
const startedAtByTask = new Map<string, number>();

type PerformanceMetadata = Record<string, string | number | boolean | null | undefined>;
type PerformanceMetadataInput<T> = PerformanceMetadata | ((result: T) => PerformanceMetadata);

/**
 * Builds the Loki timestamp format from the current wall-clock time.
 */
function getLokiTimestamp() {
  // Loki expects timestamps as nanoseconds in a string.
  return `${BigInt(Date.now()) * 1_000_000n}`;
}

/**
 * Sends one performance measurement directly to Loki.
 */
function pushPerformanceLine(line: string) {
  // Performance logs are optional, so local runs can omit Loki completely.
  if (!lokiUrl) {
    return;
  }

  // The labels keep these logs queryable without mixing them with normal app logs.
  const body = {
    streams: [
      {
        stream: {
          app: 'beacon-chain-validators-monitor',
          job: 'indexer-xstate-performance',
          source: 'xstate',
        },
        values: [[getLokiTimestamp(), line]],
      },
    ],
  };

  // Loki is not critical for indexing, so this intentionally does not await.
  void fetch(lokiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((error) => {
    // Keep Loki failures visible while preserving non-critical logging behavior.
    console.error('[PerformanceLogger] Failed to push performance log to Loki', error);
  });
}

/**
 * Formats optional metadata as stable key-value pairs.
 */
function formatMetadata(metadata?: PerformanceMetadata) {
  if (!metadata) {
    return '';
  }

  // Keep the field order provided by the caller so logs stay predictable.
  const fields = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`);

  return fields.length > 0 ? ` | ${fields.join(' ')}` : '';
}

/**
 * Resolves static or result-based metadata for a completed measurement.
 */
function resolveMetadata<T>(metadata: PerformanceMetadataInput<T> | undefined, result: T) {
  if (typeof metadata === 'function') {
    return metadata(result);
  }

  return metadata;
}

/**
 * Writes one elapsed duration for code that is not running as an XState action.
 */
export function recordPerformanceTask(
  scope: string,
  task: string,
  duration: number,
  metadata?: PerformanceMetadata,
) {
  // Direct measurements use the same line format as XState entry/exit timers.
  pushPerformanceLine(`${scope} | ${task} | ${duration}ms${formatMetadata(metadata)}`);
}

/**
 * Measures one async operation using an explicit performance scope.
 */
export async function measurePerformanceTask<T>(
  scope: string,
  task: string,
  operation: () => Promise<T>,
  metadata?: PerformanceMetadataInput<T>,
): Promise<T> {
  // Date.now keeps direct measurements consistent with the existing XState timers.
  const startedAt = Date.now();
  let result: T;

  try {
    result = await operation();
  } catch (error) {
    recordPerformanceTask(scope, task, Date.now() - startedAt);
    throw error;
  }

  recordPerformanceTask(scope, task, Date.now() - startedAt, resolveMetadata(metadata, result));
  return result;
}

/**
 * Builds the scope prefix for epoch, slot, or generic machine task logs.
 */
function formatScope(context: Record<string, unknown>, fallbackScope: string) {
  // Epoch tasks use only the epoch prefix.
  const epoch = typeof context.epoch === 'number' ? `epoch:${context.epoch}` : null;

  // Slot tasks include both epoch and slot so they group naturally in Grafana.
  const slot = typeof context.slot === 'number' ? `slot:${context.slot}` : null;

  if (epoch && slot) {
    return `${epoch} > ${slot}`;
  }

  return epoch || slot || fallbackScope;
}

/**
 * Builds the map key used to pair a state entry with its exit.
 */
function getTaskKey(scope: string, task: string) {
  // The key only needs to be unique inside this process.
  return `${scope}|${task}`;
}

/**
 * Stores the start timestamp for one task state.
 */
export function startPerformanceTask<TContext extends MachineContext, TEvent extends EventObject>(
  task: string,
) {
  return ({ context, self }: ActionArgs<TContext, TEvent, TEvent>) => {
    // Scope and task identify the state whose duration is being measured.
    const scope = formatScope(context as Record<string, unknown>, self.id);
    const key = getTaskKey(scope, task);

    startedAtByTask.set(key, Date.now());
  };
}

/**
 * Writes the elapsed time for one task state.
 */
export function endPerformanceTask<TContext extends MachineContext, TEvent extends EventObject>(
  task: string,
) {
  return ({ context, self }: ActionArgs<TContext, TEvent, TEvent>) => {
    // Scope and task must match the entry action for this state.
    const scope = formatScope(context as Record<string, unknown>, self.id);
    const key = getTaskKey(scope, task);
    const startedAt = startedAtByTask.get(key);

    if (startedAt === undefined) {
      return;
    }

    // Push the final plain-text duration and remove the active timer.
    pushPerformanceLine(`${scope} | ${task} | ${Date.now() - startedAt}ms`);
    startedAtByTask.delete(key);
  };
}
