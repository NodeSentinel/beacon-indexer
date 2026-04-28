import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

type TraceEventKind = 'span.start' | 'span.end' | 'span.abort';

interface ActiveSpan {
  spanId: string;
  machineId: string;
  state: string;
  traceId: string;
  parentSpanId: string | null;
  startedAt: number;
  payload?: Record<string, unknown>;
}

interface TraceEvent {
  timestamp: string;
  kind: TraceEventKind;
  message: string;
  machineGroup: string;
  machineName: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  machineId: string;
  task: string;
  durationMs?: number;
  reason?: string;
  payload?: Record<string, unknown>;
}

interface TraceUpdateOptions {
  parentMachineId?: string;
  traceRootId?: string;
}

class MachineTracer {
  private activeSpans = new Map<string, ActiveSpan>();
  private traceFilePath: string;

  constructor() {
    const logsDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    this.traceFilePath = path.join(logsDir, 'xstate-traces.ndjson');
  }

  /**
   * Track a machine state and emit span start/end events.
   */
  trackState(machineId: string, state: unknown, context?: unknown, options?: TraceUpdateOptions) {
    const nextState = this.formatState(state);
    const now = Date.now();
    const traceId = options?.traceRootId || machineId;
    const parentSpanId = options?.parentMachineId || null;
    const payload = this.buildPayload(machineId, nextState, context, traceId, parentSpanId);
    const current = this.activeSpans.get(machineId);

    if (!current) {
      const spanId = randomUUID();
      this.activeSpans.set(machineId, {
        spanId,
        machineId,
        state: nextState,
        traceId,
        parentSpanId,
        startedAt: now,
        payload,
      });

      this.writeEvent({
        timestamp: new Date(now).toISOString(),
        kind: 'span.start',
        message: this.buildMessage(machineId, nextState, payload),
        machineGroup: this.getMachineGroup(machineId),
        machineName: this.getMachineName(machineId),
        traceId,
        spanId,
        parentSpanId,
        machineId,
        task: nextState,
        payload,
      });
      return;
    }

    if (current.state === nextState) {
      return;
    }

    this.writeEvent({
      timestamp: new Date(now).toISOString(),
      kind: 'span.end',
      message: this.buildMessage(
        machineId,
        current.state,
        current.payload,
        now - current.startedAt,
      ),
      machineGroup: this.getMachineGroup(machineId),
      machineName: this.getMachineName(machineId),
      traceId: current.traceId,
      spanId: current.spanId,
      parentSpanId: current.parentSpanId,
      machineId,
      task: current.state,
      durationMs: now - current.startedAt,
      payload: current.payload,
    });

    const spanId = randomUUID();
    this.activeSpans.set(machineId, {
      spanId,
      machineId,
      state: nextState,
      traceId,
      parentSpanId,
      startedAt: now,
      payload,
    });

    this.writeEvent({
      timestamp: new Date(now).toISOString(),
      kind: 'span.start',
      message: this.buildMessage(machineId, nextState, payload),
      machineGroup: this.getMachineGroup(machineId),
      machineName: this.getMachineName(machineId),
      traceId,
      spanId,
      parentSpanId,
      machineId,
      task: nextState,
      payload,
    });
  }

  /**
   * Finish the active span for a machine.
   */
  finalizeState(machineId: string, reason?: string, context?: unknown) {
    const current = this.activeSpans.get(machineId);
    if (!current) {
      return;
    }

    const now = Date.now();
    const payload = this.buildPayload(
      machineId,
      current.state,
      context ?? current.payload ?? null,
      current.traceId,
      current.parentSpanId,
    );

    this.writeEvent({
      timestamp: new Date(now).toISOString(),
      kind: 'span.end',
      message: this.buildMessage(machineId, current.state, payload, now - current.startedAt),
      machineGroup: this.getMachineGroup(machineId),
      machineName: this.getMachineName(machineId),
      traceId: current.traceId,
      spanId: current.spanId,
      parentSpanId: current.parentSpanId,
      machineId,
      task: current.state,
      durationMs: now - current.startedAt,
      reason,
      payload,
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
        message: this.buildMessage(
          current.machineId,
          current.state,
          current.payload,
          now - current.startedAt,
        ),
        machineGroup: this.getMachineGroup(current.machineId),
        machineName: this.getMachineName(current.machineId),
        traceId: current.traceId,
        spanId: current.spanId,
        parentSpanId: current.parentSpanId,
        machineId: current.machineId,
        task: current.state,
        durationMs: now - current.startedAt,
        reason: 'shutdown',
        payload: current.payload,
      });
    }

    this.activeSpans.clear();
  }

  /**
   * Convert a snapshot state into a stable string.
   */
  private formatState(state: unknown) {
    if (typeof state === 'string') {
      return state.replace(/^State:\s*/, '');
    }

    try {
      return this.summarizeState(state);
    } catch {
      return String(state);
    }
  }

  /**
   * Turn a nested XState snapshot into a short readable task label.
   */
  private summarizeState(state: unknown) {
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
   * Build a flat payload that Loki can query without recursive cleaning.
   */
  private buildPayload(
    machineId: string,
    task: string,
    context: unknown,
    traceId: string,
    parentSpanId: string | null,
  ) {
    const payload: Record<string, unknown> = {
      machine_id: machineId,
      machine_group: this.getMachineGroup(machineId),
      machine_name: this.getMachineName(machineId),
      task,
      trace_id: traceId,
      parent_span_id: parentSpanId,
    };

    if (context && typeof context === 'object') {
      const source = context as Record<string, unknown>;
      for (const key of [
        'epoch',
        'slot',
        'startSlot',
        'endSlot',
        'currentSlot',
        'lookbackSlot',
        'slotDuration',
        'slotsPerEpoch',
        'maxParallelEpochs',
      ]) {
        const value = source[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          payload[key] = value;
        }
      }
    }

    return payload;
  }

  /**
   * Build a short human-readable message for Grafana.
   */
  private buildMessage(
    machineId: string,
    task: string,
    payload: Record<string, unknown> | undefined,
    durationMs?: number,
  ) {
    const parts = [`${this.getMachineGroup(machineId)} ${machineId}`, task];
    const fields = payload ?? {};

    if (typeof fields.epoch === 'number') {
      parts.push(`epoch=${fields.epoch}`);
    }
    if (typeof fields.slot === 'number') {
      parts.push(`slot=${fields.slot}`);
    }
    if (typeof durationMs === 'number') {
      parts.push(`durationMs=${durationMs}`);
    }
    return parts.join(' | ');
  }

  /**
   * Map a machine id to a stable high-level group.
   */
  private getMachineGroup(machineId: string) {
    if (machineId.startsWith('epoch')) {
      return 'epoch';
    }
    if (machineId.startsWith('slot')) {
      return 'slot';
    }
    if (machineId.toLowerCase().includes('archive')) {
      return 'archive';
    }
    if (machineId.startsWith('snapshot')) {
      return 'snapshot';
    }
    return 'other';
  }

  /**
   * Map a machine id to a stable machine name for Loki labels.
   */
  private getMachineName(machineId: string) {
    return machineId.split(':')[0] || machineId;
  }

  /**
   * Append a trace event to the NDJSON file.
   */
  private writeEvent(event: TraceEvent) {
    fs.appendFileSync(this.traceFilePath, `${JSON.stringify(event)}\n`);
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
