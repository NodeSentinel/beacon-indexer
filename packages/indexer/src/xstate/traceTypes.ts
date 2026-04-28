/**
 * Shared trace options used by XState logging and tracing helpers.
 */
export interface TraceOptions {
  parentMachineId?: string;
  traceRootId?: string;
}

/**
 * Trace update options are the same shape as the shared trace options.
 */
export type TraceUpdateOptions = TraceOptions;
