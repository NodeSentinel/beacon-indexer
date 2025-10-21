import { test, expect, vi, beforeEach } from 'vitest';
import { createActor, createMachine, sendParent } from 'xstate';

import { createControllablePromise } from '@/src/__tests__/utils.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
// eslint-disable-next-line import/order
import { BeaconTime } from '@/src/services/consensus/utils/time.js';

const mockEpochController = {
  getLastCreated: vi.fn(),
  getEpochsToCreate: vi.fn(),
  createEpochs: vi.fn(),
  getMinEpochToProcess: vi.fn(),
  markEpochAsProcessed: vi.fn(),
} as unknown as EpochController;

// Mock BeaconTime instance for testing
const GENESIS_TIMESTAMP = 1606824000000; // Example genesis timestamp
const SLOT_DURATION_MS = 100; // 100ms per slot for fast tests
const SLOTS_PER_EPOCH = 32;
const mockBeaconTime = new BeaconTime({
  genesisTimestamp: GENESIS_TIMESTAMP,
  slotDurationMs: SLOT_DURATION_MS,
  slotsPerEpoch: SLOTS_PER_EPOCH,
  epochsPerSyncCommitteePeriod: 256, // 256 epochs per sync committee period
  slotStartIndexing: 32,
});

// Mock the logging functions - simple mocks that do nothing
const mockLogActor = vi.fn();

// Mock the modules
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

vi.mock('@/src/xstate/multiMachineLogger.js', () => ({
  logActor: vi.fn(),
}));

// Mock the epoch processor machine to avoid database and network calls
vi.mock('@/src/xstate/epoch/epochProcessor.machine.js', () => {
  const mockMachine = createMachine({
    id: 'EpochProcessor',
    types: {} as {
      events: { type: 'complete' };
    },
    initial: 'idle',
    states: {
      idle: {
        on: {
          complete: 'completed',
        },
      },
      completed: {
        entry: [
          sendParent(() => ({
            type: 'EPOCH_COMPLETED',
            machineId: `epochProcessor:100`,
          })),
          () => console.log('Sending EPOCH_COMPLETED to parent'),
        ],
        type: 'final',
      },
    },
  });

  return {
    epochProcessorMachine: mockMachine,
  };
});

// Import the orchestrator after mocks are set up
import { epochOrchestratorMachine } from '@/src/xstate/epoch/epochOrchestrator.machine.js';

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  mockLogActor.mockReturnValue(undefined);
});

describe.skip('epochOrchestratorMachine', () => {
  test('should initialize with correct context and transition to gettingMinEpoch', async () => {
    // Arrange
    const controllableGetMinEpochPromise = createControllablePromise<null>();

    vi.mocked(mockEpochController.getMinEpochToProcess).mockImplementation(
      () => controllableGetMinEpochPromise.promise,
    );

    const actor = createActor(epochOrchestratorMachine, {
      input: {
        slotDuration: 0.1, // 100ms for faster tests
        lookbackSlot: 32,
        epochController: mockEpochController,
        beaconTime: mockBeaconTime,
      },
    });

    // Act
    actor.start();

    // Assert - Check state immediately after start (before async operation completes)
    let snapshot = actor.getSnapshot();

    // Check that context is properly initialized
    expect(snapshot.context.epochData).toBe(null);
    expect(snapshot.context.epochActor).toBe(null);
    expect(snapshot.context.slotDuration).toBe(0.1);
    expect(snapshot.context.lookbackSlot).toBe(32);

    // The machine should be in gettingMinEpoch state
    expect(snapshot.value).toBe('gettingMinEpoch');

    // Verify that getMinEpochToProcess was called at least once
    expect(vi.mocked(mockEpochController.getMinEpochToProcess)).toHaveBeenCalledTimes(1);

    // Now resolve the promise to complete the async operation
    controllableGetMinEpochPromise.resolve(null);

    // Wait for the state transition to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert - Should transition to noMinEpochToProcess after resolving with null
    snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('noMinEpochToProcess');
    expect(snapshot.context.epochData).toBe(null);

    // Clean up
    actor.stop();
  });

  test('should handle getMinEpochToProcess error and retry after 1s', async () => {
    // Arrange
    const controllableGetMinEpochPromise = createControllablePromise<null>();

    vi.mocked(mockEpochController.getMinEpochToProcess).mockImplementation(
      () => controllableGetMinEpochPromise.promise,
    );

    // Track both microsteps and states using XState inspection API
    const microstepValues: string[] = [];
    const actor = createActor(epochOrchestratorMachine, {
      input: {
        slotDuration: 0.1, // 100ms for faster tests
        lookbackSlot: 32,
        epochController: mockEpochController,
        beaconTime: mockBeaconTime,
      },
      inspect: (inspectionEvent) => {
        if (inspectionEvent.type === '@xstate.microstep') {
          // @ts-expect-error - snapshot.value exists at runtime for microstep events but not in type definition
          microstepValues.push(inspectionEvent.snapshot.value);
        }
      },
    });

    // Act
    actor.start();

    // Assert - Should be in gettingMinEpoch state initially
    let snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('gettingMinEpoch');
    expect(vi.mocked(mockEpochController.getMinEpochToProcess)).toHaveBeenCalledTimes(1);

    // Now reject the promise to trigger error handling
    controllableGetMinEpochPromise.reject(new Error('Database connection failed'));

    // Wait for the state transition to complete
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should transition to noMinEpochToProcess after error
    snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('noMinEpochToProcess');

    // Verify we went through the expected states using microsteps in correct order
    expect(microstepValues.length).toBeGreaterThanOrEqual(1);
    expect(microstepValues[0]).toBe('noMinEpochToProcess');

    // Wait for retry (33ms delay + some buffer)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert - Should have been called at least 2 times (initial + retry)
    expect(
      vi.mocked(mockEpochController.getMinEpochToProcess).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);

    // With always transitions, we get fewer microsteps but the retry still happens
    // The important thing is that the function was called multiple times
    expect(
      vi.mocked(mockEpochController.getMinEpochToProcess).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);

    // Clean up
    actor.stop();
  });

  test('should handle null epoch data and transition to noMinEpochToProcess, then retry after 1s', async () => {
    // Arrange
    const controllableGetMinEpochPromise = createControllablePromise<null>();

    vi.mocked(mockEpochController.getMinEpochToProcess).mockImplementation(
      () => controllableGetMinEpochPromise.promise,
    );

    const actor = createActor(epochOrchestratorMachine, {
      input: {
        slotDuration: 0.1, // 100ms for faster tests
        lookbackSlot: 32,
        epochController: mockEpochController,
        beaconTime: mockBeaconTime,
      },
    });

    // Track state transitions for additional verification
    const stateTransitions: string[] = [];
    const subscription = actor.subscribe((snapshot) => {
      stateTransitions.push(snapshot.value as string);
    });

    // Act
    actor.start();

    // Assert - Should be in gettingMinEpoch state initially
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('gettingMinEpoch');
    expect(vi.mocked(mockEpochController.getMinEpochToProcess)).toHaveBeenCalledTimes(1);

    // Now resolve the promise with null to trigger the null handling
    controllableGetMinEpochPromise.resolve(null);

    // Wait for the state transition to complete
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should transition to noMinEpochToProcess after resolving with null
    // Use the last state from transitions instead of current snapshot
    const finalState = stateTransitions[stateTransitions.length - 1];
    expect(finalState).toBe('noMinEpochToProcess');

    // Wait for the 33ms delay to complete and retry
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert - Should have been called at least 2 times (initial + retry)
    expect(
      vi.mocked(mockEpochController.getMinEpochToProcess).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);

    // Verify we went through the expected states at least the expected number of times
    const gettingMinEpochCount = stateTransitions.filter(
      (state) => state === 'gettingMinEpoch',
    ).length;
    const noMinEpochToProcessCount = stateTransitions.filter(
      (state) => state === 'noMinEpochToProcess',
    ).length;

    expect(gettingMinEpochCount).toBeGreaterThanOrEqual(2);
    expect(noMinEpochToProcessCount).toBeGreaterThanOrEqual(2);

    // Clean up
    subscription.unsubscribe();
    actor.stop();
  });

  test('should complete full workflow: gettingMinEpoch -> checkingIfCanSpawnEpochProcessor -> processingEpoch -> EPOCH_COMPLETED -> gettingMinEpoch', async () => {
    // Arrange
    const mockEpochData = {
      epoch: 100,
      processed: false,
      validatorsBalancesFetched: false,
      validatorsActivationFetched: false,
      rewards_fetched: false,
      rewards_summarized: false,
      committeesFetched: false,
      slotsFetched: false,
      syncCommitteesFetched: false,
    };

    // Create a controllable promise for getMinEpochToProcess
    const getMinEpochPromise = createControllablePromise<{
      epoch: number;
      processed: boolean;
      validatorsBalancesFetched: boolean;
      validatorsActivationFetched: boolean;
      rewards_fetched: boolean;
      rewards_summarized: boolean;
      committeesFetched: boolean;
      slotsFetched: boolean;
      syncCommitteesFetched: boolean;
    } | null>();

    vi.mocked(mockEpochController.getMinEpochToProcess).mockImplementation(
      () => getMinEpochPromise.promise,
    );

    // Track microsteps using XState inspection API
    const microstepValues: string[] = [];
    const epochOrchestratorActor = createActor(epochOrchestratorMachine, {
      input: {
        slotDuration: 0.1, // 100ms for faster tests
        lookbackSlot: 32,
        epochController: mockEpochController,
        beaconTime: mockBeaconTime,
      },
      inspect: (inspectionEvent) => {
        if (inspectionEvent.type === '@xstate.microstep') {
          // @ts-expect-error - snapshot.value exists at runtime for microstep events but not in type definition
          microstepValues.push(inspectionEvent.snapshot.value);
        }
      },
    });

    // Act
    epochOrchestratorActor.start();

    // Assert - Should be in gettingMinEpoch state initially
    let snapshot = epochOrchestratorActor.getSnapshot();
    expect(snapshot.value).toBe('gettingMinEpoch');

    // Now resolve the promise, providing the mock epoch data to continue the workflow
    getMinEpochPromise.resolve(mockEpochData);

    // Wait for the state transitions to complete (gettingMinEpoch -> checkingIfCanSpawnEpochProcessor -> processingEpoch)
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should be in processingEpoch with epoch actor spawned
    snapshot = epochOrchestratorActor.getSnapshot();
    expect(snapshot.value).toBe('processingEpoch');
    expect(snapshot.context.epochData).toEqual(mockEpochData);
    expect(snapshot.context.epochActor).not.toBe(null);

    // Update mock to return null for subsequent calls to prevent further processing
    vi.mocked(mockEpochController.getMinEpochToProcess).mockResolvedValue(null);

    // Send EPOCH_COMPLETED event directly to the orchestrator to simulate completion
    epochOrchestratorActor.send({ type: 'EPOCH_COMPLETED', machineId: 'epochProcessor:100' });

    // Wait for the epoch processor to complete and send EPOCH_COMPLETED event
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Wait a bit more for any pending state transitions
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should be back to noMinEpochToProcess with cleaned context
    snapshot = epochOrchestratorActor.getSnapshot();
    expect(snapshot.value).toBe('noMinEpochToProcess');
    expect(snapshot.context.epochData).toBe(null);
    expect(snapshot.context.epochActor).toBe(null);

    // Note: markEpochAsProcessed is called by the epochProcessor, not the orchestrator
    // The orchestrator just receives the EPOCH_COMPLETED event and cleans up

    // Verify the state transitions using microsteps in correct order
    expect(microstepValues.length).toBeGreaterThanOrEqual(2);
    expect(microstepValues[0]).toBe('checkingIfCanSpawnEpochProcessor');
    expect(microstepValues[1]).toBe('processingEpoch');

    // Clean up
    epochOrchestratorActor.stop();
  });
});
