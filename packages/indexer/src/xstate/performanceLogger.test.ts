import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Loads the performance logger after each test configures environment variables.
 */
async function importPerformanceLogger() {
  // Re-import the module so module-level environment reads use the test values.
  vi.resetModules();

  return import('./performanceLogger.js');
}

/**
 * Builds the minimal XState action args used by the performance logger actions.
 */
function buildActionArgs(context: Record<string, unknown>, id = 'test-machine') {
  // The logger only reads context and self.id from the XState action args.
  return {
    context,
    self: { id },
  } as never;
}

describe('performanceLogger', () => {
  const originalLokiUrl = process.env.LOKI_URL;

  beforeEach(() => {
    // Use fake timers so task duration assertions stay deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    // Restore global state so these tests do not leak into other suites.
    if (originalLokiUrl === undefined) {
      delete process.env.LOKI_URL;
    } else {
      process.env.LOKI_URL = originalLokiUrl;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('pushes completed task measurements to Loki using the env URL', async () => {
    // Configure the Loki endpoint before importing the logger module.
    process.env.LOKI_URL = 'http://loki.test/loki/api/v1/push';

    // Mock fetch so the test observes the outbound Loki request without network I/O.
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    // Load the actions after the environment and fetch mock are ready.
    const { endPerformanceTask, startPerformanceTask } = await importPerformanceLogger();

    // Start the task with epoch and slot context so the logger builds the grouped scope.
    startPerformanceTask('fetchBeaconBlock')(buildActionArgs({ epoch: 42, slot: 1344 }));

    // Advance time so the completed task has a measurable duration.
    vi.advanceTimersByTime(125);

    // End the task, which should enqueue one best-effort Loki push.
    endPerformanceTask('fetchBeaconBlock')(buildActionArgs({ epoch: 42, slot: 1344 }));

    // Allow the fire-and-forget promise chain to run.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Verify the request goes to the configured Loki URL.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://loki.test/loki/api/v1/push',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    // Verify the Loki payload keeps the performance stream isolated with labels.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      streams: [
        {
          stream: {
            app: 'beacon-chain-validators-monitor',
            job: 'indexer-xstate-performance',
            source: 'xstate',
          },
          values: [[expect.any(String), 'epoch:42 > slot:1344 | fetchBeaconBlock | 125ms']],
        },
      ],
    });
  });

  it('ignores Loki failures because performance logs are non-critical', async () => {
    // Configure the Loki endpoint before importing the logger module.
    process.env.LOKI_URL = 'http://loki.test/loki/api/v1/push';

    // Spy on console errors so the test can verify the diagnostic output.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Mock a failed network call to prove logging never throws back into XState.
    const lokiError = new Error('Loki is unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(lokiError));

    // Load the actions after the environment and fetch mock are ready.
    const { endPerformanceTask, startPerformanceTask } = await importPerformanceLogger();

    // Start and end a task around a deterministic one millisecond duration.
    startPerformanceTask('syncing')(buildActionArgs({ epoch: 7 }));
    vi.advanceTimersByTime(1);

    // The logger must swallow the rejected push promise.
    expect(() => {
      endPerformanceTask('syncing')(buildActionArgs({ epoch: 7 }));
    }).not.toThrow();

    // The rejected push promise should still emit a diagnostic for operators.
    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[PerformanceLogger] Failed to push performance log to Loki',
        lokiError,
      );
    });
  });

  it('measures direct async tasks with an explicit scope', async () => {
    // Configure the Loki endpoint before importing the logger module.
    process.env.LOKI_URL = 'http://loki.test/loki/api/v1/push';

    // Mock fetch so direct measurements can be inspected without network I/O.
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    // Load the helper after the environment and fetch mock are ready.
    const { measurePerformanceTask } = await importPerformanceLogger();

    // Measure a task that advances fake time while it runs.
    await measurePerformanceTask(
      'epoch:42 > slot:1344',
      'processAttestations:parseBits',
      async () => {
        vi.advanceTimersByTime(17);
      },
    );

    // Allow the fire-and-forget Loki push to run.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Verify the direct measurement uses the provided scope and task name.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.streams[0].values[0][1]).toBe(
      'epoch:42 > slot:1344 | processAttestations:parseBits | 17ms',
    );
  });
});
