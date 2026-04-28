import type { TraceDefinition } from '@/src/xstate/traceTypes.js';
import { buildTraceDefinition } from '@/src/xstate/traceUtils.js';

/**
 * Builds the trace record for epoch-level machines.
 */
export function buildEpochTrace(
  machineName: string,
  input: {
    machineId: string;
    state: unknown;
    context?: {
      epoch?: number;
      startSlot?: number;
      endSlot?: number;
      traceRootId?: string;
      [key: string]: unknown;
    };
    traceRootId?: string;
    parentMachineId?: string;
    fieldKeys?: readonly string[];
    messagePrefix?: string;
  },
): TraceDefinition {
  return buildTraceDefinition({
    machineGroup: 'epoch',
    machineName,
    machineId: input.machineId,
    state: input.state,
    context: input.context,
    traceRootId: input.traceRootId,
    parentMachineId: input.parentMachineId,
    fieldKeys: input.fieldKeys ?? ['epoch', 'startSlot', 'endSlot'],
    messagePrefix: input.messagePrefix ?? 'epoch',
  });
}
