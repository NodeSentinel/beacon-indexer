import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createTaskMonitor } from './taskMonitor.js';

describe('createTaskMonitor', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test('records one running event and one done event for a task instance', () => {
    const sink = vi.fn();
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_250);
    const monitor = createTaskMonitor({ now, sink });

    const taskId = monitor.start({
      actorId: 'epochProcessor:10',
      context: { epoch: 10 },
      taskPath: ['fetch validators'],
    });

    monitor.end(taskId);
    monitor.end(taskId);

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        epoch: 10,
        status: 'running',
        taskPath: 'epoch 10 / fetch validators',
      }),
    );
    expect(sink).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        deltaDisplay: '+0s',
        status: 'done',
        taskPath: 'epoch 10 / fetch validators',
        totalDisplay: '1.25s',
      }),
    );
  });

  test('builds slot task paths from epoch, slot, and nested task names', () => {
    const sink = vi.fn();
    const monitor = createTaskMonitor({ now: () => 10_000, sink });

    monitor.start({
      actorId: 'slotProcessor:10:320',
      context: { epoch: 10, slot: 320 },
      taskPath: ['process attestations', 'save attestations'],
    });

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        epoch: 10,
        slot: 320,
        task: 'save attestations',
        taskFilter: 'slot: save attestations',
        taskPath: 'epoch 10 / slot 320 / process attestations / save attestations',
      }),
    );
  });

  test('builds task filter labels from the task owner', () => {
    const sink = vi.fn();
    const monitor = createTaskMonitor({ now: () => 10_000, sink });

    monitor.start({
      actorId: 'epochProcessor:10',
      context: { epoch: 10 },
      taskPath: ['process slots'],
    });

    monitor.start({
      actorId: 'slotProcessor:10:320',
      context: { epoch: 10, slot: 320 },
      taskPath: ['fetch beacon block'],
    });

    expect(sink).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        task: 'process slots',
        taskFilter: 'epoch: process slots',
      }),
    );
    expect(sink).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        task: 'fetch beacon block',
        taskFilter: 'slot: fetch beacon block',
      }),
    );
  });

  test('adds total label to completed container task display paths', () => {
    const sink = vi.fn();
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    const monitor = createTaskMonitor({ now, sink });

    const taskId = monitor.start({
      actorId: 'slotProcessor:10:320',
      context: { epoch: 10, slot: 320 },
      taskPath: ['slot'],
    });

    monitor.end(taskId);

    expect(sink).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        isTotal: false,
        taskPath: 'epoch 10 / slot 320',
        taskPathDisplay: 'epoch 10 / slot 320',
      }),
    );
    expect(sink).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        isTotal: true,
        taskPath: 'epoch 10 / slot 320',
        taskPathDisplay: 'epoch 10 / slot 320 / TOTAL',
      }),
    );
  });

  test('records errors once using the same task instance', () => {
    const sink = vi.fn();
    const now = vi.fn().mockReturnValueOnce(5_000).mockReturnValueOnce(5_250);
    const monitor = createTaskMonitor({ now, sink });

    const taskId = monitor.start({
      actorId: 'slotProcessor:10:320',
      context: { epoch: 10, slot: 320 },
      taskPath: ['fetch block rewards'],
    });

    monitor.error(taskId, new Error('beacon failed'));
    monitor.error(taskId, new Error('duplicate'));

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink).toHaveBeenLastCalledWith(
      expect.objectContaining({
        errorMessage: 'beacon failed',
        status: 'error',
        totalDisplay: '0.25s',
      }),
    );
  });
});
