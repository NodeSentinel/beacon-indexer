import fs from 'fs';
import path from 'path';
import type { ActionArgs, EventObject, MachineContext } from 'xstate';

const logsDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const logFilePath = path.join(logsDir, 'xstate-performance.log');
const startedAtByTask = new Map<string, number>();

/**
 * Appends one plain-text measurement line to the performance log.
 */
function appendLine(line: string) {
  // Create the logs directory lazily so local and Docker runs both work.
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Loki reads this file as plain text, one measurement per line.
  fs.appendFileSync(logFilePath, `${line}\n`);
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

    // Write the final plain-text duration and remove the active timer.
    appendLine(`${scope} | ${task} | ${Date.now() - startedAt}ms`);
    startedAtByTask.delete(key);
  };
}
