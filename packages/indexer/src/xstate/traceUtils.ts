import type { TraceDefinition, TraceScalar } from './traceTypes.js';

/**
 * Builds a stable, readable state label from an XState snapshot.
 */
export function formatStatePath(state: unknown) {
  if (typeof state === 'string') {
    return state.replace(/^State:\s*/, '');
  }

  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return String(state);
  }

  const paths: string[] = [];

  const walk = (value: unknown, prefix: string[] = []) => {
    if (typeof value === 'string') {
      paths.push([...prefix, value].join('.'));
      return;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      paths.push(prefix.join('.'));
      return;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      paths.push(prefix.join('.'));
      return;
    }

    for (const [key, child] of entries) {
      walk(child, [...prefix, key]);
    }
  };

  walk(state);

  return paths.filter(Boolean).join(', ');
}

/**
 * Builds a trace definition from explicit machine metadata and optional fields.
 */
export function buildTraceDefinition(input: {
  machineGroup: TraceDefinition['machineGroup'];
  machineName: string;
  machineId: string;
  state: unknown;
  context?: Record<string, unknown>;
  traceRootId?: string;
  parentMachineId?: string;
  fields?: Record<string, TraceScalar>;
  fieldKeys?: readonly string[];
  messagePrefix?: string;
}): TraceDefinition {
  const task = formatStatePath(input.state);
  const context = input.context ?? {};
  const fields =
    input.fields ??
    (input.fieldKeys && input.fieldKeys.length > 0
      ? pickTraceFields(context, input.fieldKeys)
      : undefined);

  return {
    machineGroup: input.machineGroup,
    machineName: input.machineName,
    traceId: input.traceRootId || (context.traceRootId as string | undefined) || input.machineId,
    parentSpanId: input.parentMachineId || null,
    task,
    fields,
    message: input.messagePrefix ? `${input.messagePrefix} | ${task}` : task,
  };
}

/**
 * Picks a small set of safe scalar fields from a source object.
 */
export function pickTraceFields(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, TraceScalar> {
  const fields: Record<string, TraceScalar> = {};

  for (const key of keys) {
    const value = source[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null ||
      value === undefined
    ) {
      fields[key] = value;
    }
  }

  return fields;
}
