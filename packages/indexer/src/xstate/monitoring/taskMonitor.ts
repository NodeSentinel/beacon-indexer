import type { ActionArgs, EventObject, MachineContext } from 'xstate';

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
  isTotal: boolean;
  reportedAt: number;
  slot?: number;
  started: string;
  status: TaskStatus;
  statusIcon: '✕' | '●' | '✓';
  task: string;
  taskPath: string;
  taskPathDisplay: string;
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
type MonitoredStateConfig = {
  entry?: unknown;
  exit?: unknown;
};
// XState's config type is too generic for a reusable wrapper that preserves
// each caller's inferred machine-specific state config.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XStateConfig = Record<string, any>;

const averageByTask = new Map<string, number>();
const containerTasks = new Set(['epoch', 'process slots', 'slot']);
const lokiUrl = process.env.LOKI_URL;

const defaultMonitor = createTaskMonitor({
  sink: (event) => {
    if (!lokiUrl) {
      return;
    }

    const body = {
      streams: [
        {
          stream: {
            app: 'beacon-chain-validators-monitor',
            epoch: event.epoch?.toString() ?? 'none',
            job: 'indexer-task-monitor',
            slot: event.slot?.toString() ?? 'none',
            status: event.status,
            task: event.task,
          },
          values: [[`${BigInt(Date.now()) * 1_000_000n}`, JSON.stringify(event)]],
        },
      ],
    };

    void fetch(lokiUrl, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }).catch((error) => {
      console.error('[TaskMonitor] Failed to push task event to Loki', error);
    });
  },
});
const taskIdByActionKey = new Map<string, string>();

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
 * Detects tasks that summarize nested work.
 */
function isContainerTask(task: string) {
  return containerTasks.has(task);
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
  const deltaSeconds = durationSeconds - previousAverage;

  if (status === 'done') {
    averageByTask.set(instance.task, (previousAverage + durationSeconds) / 2);
  }

  const isTotal = status !== 'running' && isContainerTask(instance.task);

  return {
    actorId: instance.actorId,
    avgDisplay: formatSeconds(previousAverage),
    deltaDisplay:
      status === 'running'
        ? undefined
        : `${deltaSeconds >= 0 ? '+' : ''}${formatSeconds(deltaSeconds)}`,
    epoch: instance.context.epoch,
    errorMessage: error instanceof Error ? error.message : undefined,
    reportedAt: now,
    slot: instance.context.slot,
    started: new Date(instance.startedAt).toLocaleTimeString(),
    status,
    statusIcon: status === 'running' ? '●' : status === 'done' ? '✓' : '✕',
    task: instance.task,
    taskPath: instance.taskPath,
    taskPathDisplay: isTotal ? `${instance.taskPath} / TOTAL` : instance.taskPath,
    isTotal,
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
      const entityPath = buildEntityPath(input.context);
      const taskPathParts =
        (task === 'epoch' && typeof input.context.epoch === 'number') ||
        (task === 'slot' && typeof input.context.slot === 'number')
          ? entityPath
          : [...entityPath, ...input.taskPath];
      const taskPath = taskPathParts.join(' / ');
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

/**
 * Creates the stable action key used to pair state entry and exit actions.
 */
function getActionKey(actorId: string, taskName: string) {
  return `${actorId}:${taskName}`;
}

/**
 * Starts one monitored XState task.
 */
function startTaskAction<TContext extends MachineContext, TEvent extends EventObject>(
  taskName: string,
) {
  return ({ context, self }: ActionArgs<TContext, TEvent, TEvent>) => {
    const taskId = defaultMonitor.start({
      actorId: self.id,
      context: context as MonitorContext,
      taskPath: [taskName],
    });

    taskIdByActionKey.set(getActionKey(self.id, taskName), taskId);
  };
}

/**
 * Ends one monitored XState task.
 */
function endTaskAction<TContext extends MachineContext, TEvent extends EventObject>(
  taskName: string,
) {
  return ({ self }: ActionArgs<TContext, TEvent, TEvent>) => {
    const actionKey = getActionKey(self.id, taskName);
    const taskId = taskIdByActionKey.get(actionKey);

    if (!taskId) {
      return;
    }

    defaultMonitor.end(taskId);
    taskIdByActionKey.delete(actionKey);
  };
}

/**
 * Records one monitored XState task as failed.
 */
export function monitorTaskError<TContext extends MachineContext, TEvent extends EventObject>(
  taskName: string,
) {
  return ({ event, self }: ActionArgs<TContext, TEvent, TEvent>) => {
    const actionKey = getActionKey(self.id, taskName);
    const taskId = taskIdByActionKey.get(actionKey);

    if (!taskId) {
      return;
    }

    const error = 'error' in event ? event.error : undefined;
    defaultMonitor.error(taskId, error);
    taskIdByActionKey.delete(actionKey);
  };
}

/**
 * Wraps a state with task monitoring entry and exit actions.
 */
// The XState state config type carries ten generic parameters, and this wrapper
// must preserve each caller's inferred machine-specific types.
export function monitoredState<
  TContext extends MachineContext,
  TEvent extends EventObject,
  TConfig extends XStateConfig,
>(taskName: string, config: TConfig): TConfig {
  const monitoredConfig = config as MonitoredStateConfig;
  const entry = Array.isArray(monitoredConfig.entry)
    ? monitoredConfig.entry
    : monitoredConfig.entry
      ? [monitoredConfig.entry]
      : [];
  const exit = Array.isArray(monitoredConfig.exit)
    ? monitoredConfig.exit
    : monitoredConfig.exit
      ? [monitoredConfig.exit]
      : [];

  return {
    ...config,
    entry: [startTaskAction<TContext, TEvent>(taskName), ...entry],
    exit: [...exit, endTaskAction<TContext, TEvent>(taskName)],
  } as TConfig;
}
