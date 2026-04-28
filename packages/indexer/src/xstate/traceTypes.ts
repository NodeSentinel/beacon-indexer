/**
 * Shared scalar values that can be written to trace records.
 */
export type TraceScalar = string | number | boolean | null | undefined;

/**
 * Shared trace record written to disk and later consumed by Loki.
 */
export interface TraceDefinition {
  machineGroup: 'epoch' | 'slot' | 'archive' | 'snapshot' | 'other';
  machineName: string;
  traceId: string;
  task: string;
  message?: string;
  parentSpanId?: string | null;
  fields?: Record<string, TraceScalar>;
}

/**
 * Shared input passed to trace builders.
 */
export interface TraceBuilderInput {
  machineId: string;
  state: unknown;
  context?: Record<string, unknown>;
  traceRootId?: string;
  parentMachineId?: string;
}

/**
 * Shared trace options used by XState logging and tracing helpers.
 */
export interface TraceOptions {
  parentMachineId?: string;
  traceRootId?: string;
  buildTrace?: (input: TraceBuilderInput) => TraceDefinition;
}

/**
 * Trace update options are the same shape as the shared trace options.
 */
export type TraceUpdateOptions = TraceOptions;
