import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import type { TraceDefinition, TraceOptions } from './traceTypes.js';
import { formatStatePath } from './traceUtils.js';

type TraceEventKind = 'span.start' | 'span.end' | 'span.abort';

interface ActiveSpan {
  spanId: string;
  machineId: string;
  definition: TraceDefinition;
  startedAt: number;
}

interface TraceEvent extends TraceDefinition {
  timestamp: string;
  kind: TraceEventKind;
  spanId: string;
  parentSpanId: string | null;
  machineId: string;
  durationMs?: number;
  reason?: string;
}

class MachineTracer {
  private activeSpans = new Map<string, ActiveSpan>();
  private traceStream: fs.WriteStream;

  constructor() {
    const logsDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const traceFilePath = path.join(logsDir, 'xstate-traces.ndjson');
    this.traceStream = fs.createWriteStream(traceFilePath, { flags: 'a' });
    this.traceStream.on('error', (error) => {
      console.error('Error writing trace file:', error);
    });
  }

  /**
   * Track a machine trace and emit span start/end events.
   */
  trackTrace(machineId: string, definition: TraceDefinition) {
    const now = Date.now();
    const current = this.activeSpans.get(machineId);

    if (!current) {
      const spanId = randomUUID();
      this.activeSpans.set(machineId, {
        spanId,
        machineId,
        definition,
        startedAt: now,
      });

      this.writeEvent({
        timestamp: new Date(now).toISOString(),
        kind: 'span.start',
        spanId,
        parentSpanId: definition.parentSpanId ?? null,
        machineId,
        ...definition,
      });
      return;
    }

    if (this.sameDefinition(current.definition, definition)) {
      return;
    }

    this.writeEvent({
      timestamp: new Date(now).toISOString(),
      kind: 'span.end',
      spanId: current.spanId,
      parentSpanId: current.definition.parentSpanId ?? null,
      machineId,
      durationMs: now - current.startedAt,
      ...current.definition,
    });

    const spanId = randomUUID();
    this.activeSpans.set(machineId, {
      spanId,
      machineId,
      definition,
      startedAt: now,
    });

    this.writeEvent({
      timestamp: new Date(now).toISOString(),
      kind: 'span.start',
      spanId,
      parentSpanId: definition.parentSpanId ?? null,
      machineId,
      ...definition,
    });
  }

  /**
   * Finish the active span for a machine.
   */
  finalizeTrace(machineId: string, reason?: string) {
    const current = this.activeSpans.get(machineId);
    if (!current) {
      return;
    }

    const now = Date.now();

    this.writeEvent({
      timestamp: new Date(now).toISOString(),
      kind: 'span.end',
      spanId: current.spanId,
      parentSpanId: current.definition.parentSpanId ?? null,
      machineId,
      durationMs: now - current.startedAt,
      reason,
      ...current.definition,
    });

    this.activeSpans.delete(machineId);
  }

  /**
   * Abort every active span on shutdown.
   */
  done() {
    const now = Date.now();

    for (const current of this.activeSpans.values()) {
      this.writeEvent({
        timestamp: new Date(now).toISOString(),
        kind: 'span.abort',
        spanId: current.spanId,
        parentSpanId: current.definition.parentSpanId ?? null,
        machineId: current.machineId,
        durationMs: now - current.startedAt,
        reason: 'shutdown',
        ...current.definition,
      });
    }

    this.activeSpans.clear();
    this.traceStream.end();
  }

  /**
   * Build a default trace definition when a machine doesn't provide one.
   */
  createDefaultDefinition(
    machineId: string,
    state: unknown,
    options?: TraceOptions,
  ): TraceDefinition {
    return {
      machineGroup: 'other',
      machineName: machineId,
      traceId: options?.traceRootId || machineId,
      parentSpanId: options?.parentMachineId || null,
      task: formatStatePath(state),
    };
  }

  /**
   * Write a trace event to the NDJSON stream.
   */
  private writeEvent(event: TraceEvent) {
    this.traceStream.write(`${JSON.stringify(event)}\n`);
  }

  /**
   * Compare two definitions by their stable fields.
   */
  private sameDefinition(left: TraceDefinition, right: TraceDefinition) {
    return (
      left.machineGroup === right.machineGroup &&
      left.machineName === right.machineName &&
      left.traceId === right.traceId &&
      left.parentSpanId === right.parentSpanId &&
      left.task === right.task &&
      JSON.stringify(left.fields ?? {}) === JSON.stringify(right.fields ?? {})
    );
  }
}

let globalMachineTracer: MachineTracer | null = null;

/**
 * Returns the shared machine tracer instance.
 */
export const getMachineTracer = () => {
  if (!globalMachineTracer) {
    globalMachineTracer = new MachineTracer();
  }

  return globalMachineTracer;
};
