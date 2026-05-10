type TaskStatus = 'done' | 'error' | 'running';

type MonitorContext = {
  epoch?: number;
  slot?: number;
};

export type TaskMonitorEvent = {
  actorId: string;
  avgDisplay: string;
  deltaDisplay?: string;
  epoch?: number;
  errorMessage?: string;
  reportedAt: number;
  slot?: number;
  started: string;
  status: TaskStatus;
  statusIcon: '✕' | '●' | '✓';
  task: string;
  taskPath: string;
  totalDisplay?: string;
};

type TaskInstance = {
  actorId: string;
  context: MonitorContext;
  startedAt: number;
  task: string;
  taskPath: string;
};

type TaskMonitorInput = {
  actorId: string;
  context: MonitorContext;
  taskPath: string[];
};

type TaskMonitorOptions = {
  now?: () => number;
  sink: (event: TaskMonitorEvent) => void;
};

const averageByTask = new Map<string, number>();

/**
 * Formats seconds for compact table display.
 */
function formatSeconds(seconds: number) {
  if (Math.abs(seconds) >= 60) {
    const minutes = seconds / 60;
    return `${Number(minutes.toFixed(2))}m`;
  }

  return `${Number(seconds.toFixed(2))}s`;
}

/**
 * Builds the entity prefix from epoch and slot context.
 */
function buildEntityPath(context: MonitorContext) {
  const parts: string[] = [];

  if (typeof context.epoch === 'number') {
    parts.push(`epoch ${context.epoch}`);
  }

  if (typeof context.slot === 'number') {
    parts.push(`slot ${context.slot}`);
  }

  return parts;
}

/**
 * Creates a compact table event for Grafana.
 */
function buildEvent(
  instance: TaskInstance,
  status: TaskStatus,
  now: number,
  error?: unknown,
): TaskMonitorEvent {
  const durationSeconds = (now - instance.startedAt) / 1000;
  const previousAverage = averageByTask.get(instance.task) ?? durationSeconds;

  if (status === 'done') {
    averageByTask.set(instance.task, (previousAverage + durationSeconds) / 2);
  }

  return {
    actorId: instance.actorId,
    avgDisplay: formatSeconds(previousAverage),
    deltaDisplay:
      status === 'running' ? undefined : formatSeconds(durationSeconds - previousAverage),
    epoch: instance.context.epoch,
    errorMessage: error instanceof Error ? error.message : undefined,
    reportedAt: now,
    slot: instance.context.slot,
    started: new Date(instance.startedAt).toLocaleTimeString(),
    status,
    statusIcon: status === 'running' ? '●' : status === 'done' ? '✓' : '✕',
    task: instance.task,
    taskPath: instance.taskPath,
    totalDisplay: status === 'running' ? undefined : formatSeconds(durationSeconds),
  };
}

/**
 * Creates an in-memory task monitor with duplicate-safe task completion.
 */
export function createTaskMonitor(options: TaskMonitorOptions) {
  const now = options.now ?? Date.now;
  const activeTasks = new Map<string, TaskInstance>();
  let nextTaskId = 0;

  return {
    start(input: TaskMonitorInput) {
      const task = input.taskPath[input.taskPath.length - 1] ?? 'unknown';
      const taskId = `${input.actorId}:${nextTaskId++}`;
      const startedAt = now();
      const taskPath = [...buildEntityPath(input.context), ...input.taskPath].join(' / ');
      const instance = {
        actorId: input.actorId,
        context: input.context,
        startedAt,
        task,
        taskPath,
      };

      activeTasks.set(taskId, instance);
      options.sink(buildEvent(instance, 'running', startedAt));

      return taskId;
    },

    end(taskId: string) {
      const instance = activeTasks.get(taskId);
      if (!instance) {
        return;
      }

      activeTasks.delete(taskId);
      options.sink(buildEvent(instance, 'done', now()));
    },

    error(taskId: string, error: unknown) {
      const instance = activeTasks.get(taskId);
      if (!instance) {
        return;
      }

      activeTasks.delete(taskId);
      options.sink(buildEvent(instance, 'error', now(), error));
    },
  };
}
