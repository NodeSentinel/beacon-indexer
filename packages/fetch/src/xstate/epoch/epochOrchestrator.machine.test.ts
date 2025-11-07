import { test, expect, vi, beforeEach } from 'vitest';
import { createActor, createMachine, sendParent, SnapshotFrom } from 'xstate';

import { createControllablePromise } from '@/src/__tests__/utils.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
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
  lookbackSlot: 32,
});

// Minimal SlotController mock for tests
const mockSlotController = {} as unknown as SlotController;

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
  test('should initialize with correct context and transition to pollingEpoch', async () => {
    // Arrange
    const controllableGetMinEpochPromise = createControllablePromise<null>();

    vi.mocked(mockEpochController.getMinEpochToProcess).mockImplementation(
      () => controllableGetMinEpochPromise.promise,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateTransitions: SnapshotFrom<any>[] = [];
    const actor = createActor(epochOrchestratorMachine, {
      input: {
        slotDuration: 0.1, // 100ms for faster tests
        lookbackSlot: 32,
        epochController: mockEpochController,
        beaconTime: mockBeaconTime,
        slotController: mockSlotController,
      },
    });

    const subscription = actor.subscribe((snapshot) => {
      stateTransitions.push(snapshot.value);
    });

    // Act
    actor.start();

    // Assert - Check initial state
    expect(stateTransitions[0]).toBe('pollingEpoch');

    // Verify that getMinEpochToProcess was called at least once
    expect(vi.mocked(mockEpochController.getMinEpochToProcess)).toHaveBeenCalledTimes(1);

    // Now resolve the promise to complete the async operation
    controllableGetMinEpochPromise.resolve(null);

    // Wait for the state transition to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert - Should transition to idleNoEpoch after resolving with null
    const lastState = stateTransitions[stateTransitions.length - 1];
    expect(lastState).toBe('idleNoEpoch');

    // Verify context using final snapshot
    const finalSnapshot = actor.getSnapshot();
    expect(finalSnapshot.context.epochData).toBe(null);
    expect(finalSnapshot.context.epochActor).toBe(null);
    expect(finalSnapshot.context.slotDuration).toBe(0.1);
    expect(finalSnapshot.context.lookbackSlot).toBe(32);

    // Clean up
    subscription.unsubscribe();
    actor.stop();
  });

  test('should handle getMinEpochToProcess error and retry after delay', async () => {
    // Arrange
    const controllableGetMinEpochPromise = createControllablePromise<null>();

    vi.mocked(mockEpochController.getMinEpochToProcess).mockImplementation(
      () => controllableGetMinEpochPromise.promise,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateTransitions: SnapshotFrom<any>[] = [];
    const actor = createActor(epochOrchestratorMachine, {
      input: {
        slotDuration: 0.1, // 100ms for faster tests
        lookbackSlot: 32,
        epochController: mockEpochController,
        beaconTime: mockBeaconTime,
        slotController: mockSlotController,
      },
    });

    const subscription = actor.subscribe((snapshot) => {
      stateTransitions.push(snapshot.value);
    });

    // Act
    actor.start();

    // Assert - Should be in pollingEpoch state initially
    expect(stateTransitions[0]).toBe('pollingEpoch');
    expect(vi.mocked(mockEpochController.getMinEpochToProcess)).toHaveBeenCalledTimes(1);

    // Now reject the promise to trigger error handling
    controllableGetMinEpochPromise.reject(new Error('Database connection failed'));

    // Wait for the state transition to complete
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should transition to idleNoEpoch after error
    const stateAfterError = stateTransitions[stateTransitions.length - 1];
    expect(stateAfterError).toBe('idleNoEpoch');

    // Wait for retry (33ms delay + some buffer)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert - Should have been called at least 2 times (initial + retry)
    expect(
      vi.mocked(mockEpochController.getMinEpochToProcess).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);

    // Verify state sequence includes expected states
    const pollingCount = stateTransitions.filter((state) => state === 'pollingEpoch').length;
    const idleCount = stateTransitions.filter((state) => state === 'idleNoEpoch').length;
    expect(pollingCount).toBeGreaterThanOrEqual(1);
    expect(idleCount).toBeGreaterThanOrEqual(1);

    // Clean up
    subscription.unsubscribe();
    actor.stop();
  });

  test('should handle null epoch data and transition to idleNoEpoch, then retry after delay', async () => {
    // Arrange
    const controllableGetMinEpochPromise = createControllablePromise<null>();

    vi.mocked(mockEpochController.getMinEpochToProcess).mockImplementation(
      () => controllableGetMinEpochPromise.promise,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateTransitions: SnapshotFrom<any>[] = [];
    const actor = createActor(epochOrchestratorMachine, {
      input: {
        slotDuration: 0.1, // 100ms for faster tests
        lookbackSlot: 32,
        epochController: mockEpochController,
        beaconTime: mockBeaconTime,
        slotController: mockSlotController,
      },
    });

    const subscription = actor.subscribe((snapshot) => {
      stateTransitions.push(snapshot.value);
    });

    // Act
    actor.start();

    // Assert - Should be in pollingEpoch state initially
    expect(stateTransitions[0]).toBe('pollingEpoch');
    expect(vi.mocked(mockEpochController.getMinEpochToProcess)).toHaveBeenCalledTimes(1);

    // Now resolve the promise with null to trigger the null handling
    controllableGetMinEpochPromise.resolve(null);

    // Wait for the state transition to complete
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should transition to idleNoEpoch after resolving with null
    const stateAfterNull = stateTransitions[stateTransitions.length - 1];
    expect(stateAfterNull).toBe('idleNoEpoch');

    // Wait for the 33ms delay to complete and retry
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert - Should have been called at least 2 times (initial + retry)
    expect(
      vi.mocked(mockEpochController.getMinEpochToProcess).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);

    // Verify we went through the expected states at least the expected number of times
    const pollingEpochCount = stateTransitions.filter((state) => state === 'pollingEpoch').length;
    const idleNoEpochCount = stateTransitions.filter((state) => state === 'idleNoEpoch').length;

    expect(pollingEpochCount).toBeGreaterThanOrEqual(2);
    expect(idleNoEpochCount).toBeGreaterThanOrEqual(2);

    // Clean up
    subscription.unsubscribe();
    actor.stop();
  });

  test('should complete full workflow: pollingEpoch -> processingEpoch -> EPOCH_COMPLETED -> pollingEpoch', async () => {
    // Arrange
    const mockEpochData = {
      epoch: 100,
      processed: false,
      validatorsBalancesFetched: false,
      validatorsActivationFetched: false,
      rewardsFetched: false,
      validatorProposerDutiesFetched: false,
      committeesFetched: false,
      allSlotsProcessed: false,
      syncCommitteesFetched: false,
    };

    // Create a controllable promise for getMinEpochToProcess
    const getMinEpochPromise = createControllablePromise<{
      epoch: number;
      processed: boolean;
      validatorsBalancesFetched: boolean;
      validatorsActivationFetched: boolean;
      rewardsFetched: boolean;
      validatorProposerDutiesFetched: boolean;
      committeesFetched: boolean;
      allSlotsProcessed: boolean;
      syncCommitteesFetched: boolean;
    } | null>();

    vi.mocked(mockEpochController.getMinEpochToProcess).mockImplementation(
      () => getMinEpochPromise.promise,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateTransitions: SnapshotFrom<any>[] = [];
    const epochOrchestratorActor = createActor(epochOrchestratorMachine, {
      input: {
        slotDuration: 0.1, // 100ms for faster tests
        lookbackSlot: 32,
        epochController: mockEpochController,
        beaconTime: mockBeaconTime,
        slotController: mockSlotController,
      },
    });

    const subscription = epochOrchestratorActor.subscribe((snapshot) => {
      stateTransitions.push(snapshot.value);
    });

    // Act
    epochOrchestratorActor.start();

    // Assert - Should be in pollingEpoch state initially
    expect(stateTransitions[0]).toBe('pollingEpoch');

    // Now resolve the promise, providing the mock epoch data to continue the workflow
    getMinEpochPromise.resolve(mockEpochData);

    // Wait for the state transitions to complete (pollingEpoch -> processingEpoch)
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should be in processingEpoch with epoch actor spawned
    const stateAfterResolve = stateTransitions[stateTransitions.length - 1];
    expect(stateAfterResolve).toBe('processingEpoch');

    // Verify context from stored snapshot
    const snapshotAtProcessing = epochOrchestratorActor.getSnapshot();
    expect(snapshotAtProcessing.context.epochData).toEqual(mockEpochData);
    expect(snapshotAtProcessing.context.epochActor).not.toBe(null);

    // Update mock to return null for subsequent calls to prevent further processing
    vi.mocked(mockEpochController.getMinEpochToProcess).mockResolvedValue(null);

    // Send EPOCH_COMPLETED event directly to the orchestrator to simulate completion
    epochOrchestratorActor.send({ type: 'EPOCH_COMPLETED', machineId: 'epochProcessor:100' });

    // Wait for the epoch processor to complete and send EPOCH_COMPLETED event
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Wait a bit more for any pending state transitions
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should be back to idleNoEpoch with cleaned context
    const finalState = stateTransitions[stateTransitions.length - 1];
    expect(finalState).toBe('idleNoEpoch');

    // Verify cleanup using final snapshot
    const finalSnapshot = epochOrchestratorActor.getSnapshot();
    expect(finalSnapshot.context.epochData).toBe(null);
    expect(finalSnapshot.context.epochActor).toBe(null);

    // Note: markEpochAsProcessed is called by the epochProcessor, not the orchestrator
    // The orchestrator just receives the EPOCH_COMPLETED event and cleans up

    // Verify the state sequence
    expect(stateTransitions.length).toBeGreaterThanOrEqual(3);
    expect(stateTransitions[0]).toBe('pollingEpoch');
    const processingIndex = stateTransitions.findIndex((state) => state === 'processingEpoch');
    expect(processingIndex).toBeGreaterThan(0);
    const idleIndex = stateTransitions.findIndex(
      (state, idx) => state === 'idleNoEpoch' && idx > processingIndex,
    );
    expect(idleIndex).toBeGreaterThan(processingIndex);

    // Clean up
    subscription.unsubscribe();
    epochOrchestratorActor.stop();
  });
});
