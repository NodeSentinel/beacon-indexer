import type { TraceDefinition } from '@/src/xstate/traceTypes.js';
import { buildTraceDefinition } from '@/src/xstate/traceUtils.js';

/**
 * Builds the trace record for slot-level machines.
 */
export function buildSlotTrace(
  machineName: string,
  input: {
    machineId: string;
    state: unknown;
    context?: {
      epoch?: number;
      slot?: number;
      startSlot?: number;
      endSlot?: number;
      currentSlot?: number | null;
      lookbackSlot?: number;
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
    machineGroup: 'slot',
    machineName,
    machineId: input.machineId,
    state: input.state,
    context: input.context,
    traceRootId: input.traceRootId,
    parentMachineId: input.parentMachineId,
    fieldKeys: input.fieldKeys ?? [
      'epoch',
      'slot',
      'startSlot',
      'endSlot',
      'currentSlot',
      'lookbackSlot',
    ],
    messagePrefix: input.messagePrefix ?? 'slot',
  });
}
