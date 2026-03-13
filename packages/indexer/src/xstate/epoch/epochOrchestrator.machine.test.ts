import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import { createMachine, sendParent } from 'xstate';

import {
  createAndStartActor,
  createControllablePromise,
  getNestedState,
} from '@/src/__tests__/utils.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';

// ============================================================================
// Test Constants - Use Gnosis chain real values (except slotDuration for fast tests)
// ============================================================================
const SLOT_DURATION = 10; // 10ms - small for fast tests (real Gnosis: 5s)
const {
  slotsPerEpoch: SLOTS_PER_EPOCH,
  genesisTimestamp: GENESIS_TIMESTAMP,
  epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
} = gnosisConfig.beacon;
const LOOKBACK_SLOT = 32;
const POLLING_DELAY = SLOT_DURATION / 2;

// ============================================================================
// Mock Controllers
// ============================================================================
const mockEpochController = {
  getLastCreated: vi.fn(),
  getEpochsToCreate: vi.fn(),
  createEpochs: vi.fn(),
  getMinEpochToProcess: vi.fn(),
  getMinEpochToProcessExcluding: vi.fn(),
  markEpochAsProcessed: vi.fn(),
} as unknown as EpochController;

const mockPartitionController = {
  createPartitionsToProcessEpoch: vi.fn(),
} as unknown as PartitionController;

const mockBeaconTime = new BeaconTime({
  genesisTimestamp: GENESIS_TIMESTAMP,
  slotDurationMs: SLOT_DURATION,
  slotsPerEpoch: SLOTS_PER_EPOCH,
  epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  lookbackSlot: LOOKBACK_SLOT,
});

const mockSlotController = {} as unknown as SlotController;

// ============================================================================
// Helper Functions
// ============================================================================

/** Create a mock epoch object with all required properties */
function createMockEpoch(epoch: number) {
  return {
    epoch,
    processed: false,
    allSlotsProcessed: false,
    committeesFetched: false,
    syncCommitteesFetched: false,
    validatorProposerDutiesFetched: false,
    validatorsBalancesFetched: false,
    validatorsActivationFetched: false,
    rewardsFetched: false,
  };
}

/** Create default input for the orchestrator machine */
function createOrchestratorInput() {
  return {
    slotDuration: SLOT_DURATION,
    slotsPerEpoch: SLOTS_PER_EPOCH,
    lookbackSlot: LOOKBACK_SLOT,
    epochController: mockEpochController,
    partitionController: mockPartitionController,
    beaconTime: mockBeaconTime,
    slotController: mockSlotController,
  };
}

/**
 * Resolve a promise and advance timers past the polling delay
 * to allow XState to process the result and cycle back to spawningEpochs.
 */
async function resolvePromiseAndAdvance<T>(promise: { resolve: (value: T) => void }, value: T) {
  promise.resolve(value);
  await vi.advanceTimersByTimeAsync(POLLING_DELAY + 1);
}

// ============================================================================
// Mocks
// ============================================================================
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

vi.mock('@/src/xstate/multiMachineLogger.js', () => ({
  logActor: vi.fn(),
}));

// Mock the epoch worker machine
vi.mock('@/src/xstate/epoch/epochWorker.machine.js', () => {
  const mockWorkerMachine = createMachine({
    id: 'EpochWorker',
    types: {} as {
      input: { epoch: number };
      events: { type: 'EPOCH_COMPLETED'; machineId: string } | { type: 'COMPLETE' };
    },
    initial: 'running',
    context: ({ input }) => ({ epoch: input.epoch }),
    states: {
      running: {
        on: {
          COMPLETE: {
            target: 'completed',
            actions: sendParent(({ context }) => ({
              type: 'EPOCH_COMPLETED',
              epoch: context.epoch,
              machineId: `epochProcessor:${context.epoch}`,
            })),
          },
        },
      },
      completed: {
        type: 'final',
      },
    },
  });

  return {
    epochWorkerMachine: mockWorkerMachine,
  };
});

// Import the orchestrator after mocks are set up
import {
  epochOrchestratorMachine,
  MAX_PARALLEL_EPOCHS,
} from '@/src/xstate/epoch/epochOrchestrator.machine.js';

// ============================================================================
// Test Setup
// ============================================================================
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
});

// ============================================================================
// Tests
// ============================================================================
describe('epochOrchestratorMachine', () => {
  test('should initialize and cycle through states when no epochs found', async () => {
    // Arrange - first call returns null (no epochs), second call blocks
    type EpochType = ReturnType<typeof createMockEpoch> | null;
    const firstCallPromise = createControllablePromise<EpochType>();
    const blockingPromise = createControllablePromise<EpochType>();

    vi.mocked(mockEpochController.getMinEpochToProcessExcluding)
      .mockReturnValueOnce(firstCallPromise.promise)
      .mockReturnValue(blockingPromise.promise); // Never resolved, blocks the machine

    const { actor, stateTransitions, subscription } = createAndStartActor(
      epochOrchestratorMachine,
      createOrchestratorInput(),
    );

    // Assert initial state is spawningEpochs
    expect(getNestedState(stateTransitions[0], 'orchestrating')).toBe('spawningEpochs');

    // Resolve first call with null (no epoch found) and let XState process the transition
    firstCallPromise.resolve(null);
    await vi.advanceTimersByTimeAsync(0);

    // stateTransitions[0] = spawningEpochs (initial)
    // stateTransitions[1] = pollingDelay (after promise resolved with null)
    expect(getNestedState(stateTransitions[1], 'orchestrating')).toBe('pollingDelay');

    // Verify getMinEpochToProcessExcluding was called with empty array
    expect(vi.mocked(mockEpochController.getMinEpochToProcessExcluding)).toHaveBeenCalledWith([]);

    // Verify context remains empty
    expect(actor.getSnapshot().context.epochs).toEqual({});

    actor.stop();
    subscription.unsubscribe();
  });

  test(`should spawn up to ${MAX_PARALLEL_EPOCHS} epochs in parallel and not exceed capacity`, async () => {
    // Arrange
    type EpochType = ReturnType<typeof createMockEpoch> | null;
    const epoch100Promise = createControllablePromise<EpochType>();
    const epoch101Promise = createControllablePromise<EpochType>();
    const epoch102Promise = createControllablePromise<EpochType>();
    const epoch103Promise = createControllablePromise<EpochType>();
    const blockingPromise = createControllablePromise<EpochType>(); // Never resolved

    vi.mocked(mockEpochController.getMinEpochToProcessExcluding)
      .mockReturnValueOnce(epoch100Promise.promise)
      .mockReturnValueOnce(epoch101Promise.promise)
      .mockReturnValueOnce(epoch102Promise.promise)
      .mockReturnValueOnce(epoch103Promise.promise) // Returns epoch but should NOT be spawned
      .mockReturnValue(blockingPromise.promise);

    const { actor, stateTransitions, subscription } = createAndStartActor(
      epochOrchestratorMachine,
      createOrchestratorInput(),
    );

    // Machine starts in spawningEpochs, waiting for first promise
    expect(getNestedState(stateTransitions[0], 'orchestrating')).toBe('spawningEpochs');

    // Resolve first epoch and advance timers to complete polling cycle
    await resolvePromiseAndAdvance(epoch100Promise, createMockEpoch(100));

    // Should have spawned epoch 100
    let snapshot = actor.getSnapshot();
    expect(snapshot.context.epochs[100]).toBe('processing');

    // Resolve second epoch
    await resolvePromiseAndAdvance(epoch101Promise, createMockEpoch(101));

    // Should have spawned epoch 101
    snapshot = actor.getSnapshot();
    expect(snapshot.context.epochs[100]).toBe('processing');
    expect(snapshot.context.epochs[101]).toBe('processing');

    // Resolve third epoch - now at capacity (3 epochs)
    await resolvePromiseAndAdvance(epoch102Promise, createMockEpoch(102));

    // Should have MAX_PARALLEL_EPOCHS epochs processing
    snapshot = actor.getSnapshot();
    expect(Object.keys(snapshot.context.epochs).length).toBe(MAX_PARALLEL_EPOCHS);
    expect(snapshot.context.epochs[100]).toBe('processing');
    expect(snapshot.context.epochs[101]).toBe('processing');
    expect(snapshot.context.epochs[102]).toBe('processing');

    // Resolve epoch 103 - query returns an epoch but it should NOT be spawned (at capacity)
    await resolvePromiseAndAdvance(epoch103Promise, createMockEpoch(103));

    // Should still have only MAX_PARALLEL_EPOCHS epochs (100, 101, 102) - epoch 103 was NOT spawned
    snapshot = actor.getSnapshot();
    expect(Object.keys(snapshot.context.epochs).length).toBe(MAX_PARALLEL_EPOCHS);
    expect(snapshot.context.epochs[100]).toBe('processing');
    expect(snapshot.context.epochs[101]).toBe('processing');
    expect(snapshot.context.epochs[102]).toBe('processing');
    expect(snapshot.context.epochs[103]).toBeUndefined();

    // Machine is blocked in spawningEpochs waiting for the blocking promise
    expect(getNestedState(snapshot.value, 'orchestrating')).toBe('spawningEpochs');

    actor.stop();
    subscription.unsubscribe();
  });

  test('should handle ordered release - only release consecutive completed epochs from lowest', async () => {
    // Arrange
    type EpochType = ReturnType<typeof createMockEpoch> | null;
    const epoch100Promise = createControllablePromise<EpochType>();
    const epoch101Promise = createControllablePromise<EpochType>();
    const epoch102Promise = createControllablePromise<EpochType>();
    const blockingPromise1 = createControllablePromise<EpochType>(); // Blocks at capacity
    const epoch103Promise = createControllablePromise<EpochType>();
    const blockingPromise2 = createControllablePromise<EpochType>(); // Blocks after new spawn

    vi.mocked(mockEpochController.getMinEpochToProcessExcluding)
      .mockReturnValueOnce(epoch100Promise.promise)
      .mockReturnValueOnce(epoch101Promise.promise)
      .mockReturnValueOnce(epoch102Promise.promise)
      .mockReturnValueOnce(blockingPromise1.promise) // Blocks when at capacity
      .mockReturnValueOnce(epoch103Promise.promise) // After releasing 100
      .mockReturnValue(blockingPromise2.promise); // Blocks after spawning 103

    const { actor, subscription } = createAndStartActor(
      epochOrchestratorMachine,
      createOrchestratorInput(),
    );

    // Spawn 3 epochs
    await resolvePromiseAndAdvance(epoch100Promise, createMockEpoch(100));
    await resolvePromiseAndAdvance(epoch101Promise, createMockEpoch(101));
    await resolvePromiseAndAdvance(epoch102Promise, createMockEpoch(102));

    // Should have MAX_PARALLEL_EPOCHS epochs processing, machine blocked on blockingPromise1
    let snapshot = actor.getSnapshot();
    expect(Object.keys(snapshot.context.epochs).length).toBe(MAX_PARALLEL_EPOCHS);
    expect(snapshot.context.epochs[100]).toBe('processing');
    expect(snapshot.context.epochs[101]).toBe('processing');
    expect(snapshot.context.epochs[102]).toBe('processing');

    // Complete epoch 102 (highest, not lowest) - global event handler updates context immediately
    actor.send({ type: 'EPOCH_COMPLETED', epoch: 102, machineId: 'epochProcessor:102' });

    // Epoch 102 should be marked as completed but NOT released yet (waiting for lowest)
    snapshot = actor.getSnapshot();
    expect(snapshot.context.epochs[102]).toBe('completed');
    expect(snapshot.context.epochs[100]).toBe('processing');
    expect(snapshot.context.epochs[101]).toBe('processing');
    expect(Object.keys(snapshot.context.epochs).length).toBe(3);

    // Complete epoch 100 (lowest) - this triggers release cycle
    actor.send({ type: 'EPOCH_COMPLETED', epoch: 100, machineId: 'epochProcessor:100' });

    // Resolve blockingPromise1 to allow transition to pollingDelay then to releasing
    await resolvePromiseAndAdvance(blockingPromise1, null);

    // After releasing epoch 100, machine should query for new epoch
    await resolvePromiseAndAdvance(epoch103Promise, createMockEpoch(103));

    // Epoch 100 should be released, epoch 103 spawned
    snapshot = actor.getSnapshot();
    expect(snapshot.context.epochs[100]).toBeUndefined(); // Released
    expect(snapshot.context.epochs[101]).toBe('processing');
    expect(snapshot.context.epochs[102]).toBe('completed'); // Still not released (waiting for 101)
    expect(snapshot.context.epochs[103]).toBe('processing');

    actor.stop();
    subscription.unsubscribe();
  });

  test('should handle global EPOCH_COMPLETED event from any state', async () => {
    // Arrange
    type EpochType = ReturnType<typeof createMockEpoch> | null;
    const epoch100Promise = createControllablePromise<EpochType>();
    const blockingPromise1 = createControllablePromise<EpochType>();
    const blockingPromise2 = createControllablePromise<EpochType>();

    vi.mocked(mockEpochController.getMinEpochToProcessExcluding)
      .mockReturnValueOnce(epoch100Promise.promise)
      .mockReturnValueOnce(blockingPromise1.promise) // Blocks after spawning 100
      .mockReturnValue(blockingPromise2.promise); // Blocks after releasing 100

    const { actor, subscription } = createAndStartActor(
      epochOrchestratorMachine,
      createOrchestratorInput(),
    );

    // Spawn first epoch
    await resolvePromiseAndAdvance(epoch100Promise, createMockEpoch(100));

    // Should have one active epoch processing, machine blocked on blockingPromise1
    let snapshot = actor.getSnapshot();
    expect(Object.keys(snapshot.context.epochs).length).toBe(1);
    expect(snapshot.context.epochs[100]).toBe('processing');

    // Send EPOCH_COMPLETED while machine is blocked - global handler updates context immediately
    actor.send({ type: 'EPOCH_COMPLETED', epoch: 100, machineId: 'epochProcessor:100' });

    // Should have marked the epoch as completed immediately
    snapshot = actor.getSnapshot();
    expect(snapshot.context.epochs[100]).toBe('completed');

    // Resolve blockingPromise1 to trigger pollingDelay -> releasingCompletedEpochs cycle
    await resolvePromiseAndAdvance(blockingPromise1, null);

    // Should have released the epoch after transition to releasingCompletedEpochs
    snapshot = actor.getSnapshot();
    expect(snapshot.context.epochs[100]).toBeUndefined();

    actor.stop();
    subscription.unsubscribe();
  });

  test('should release multiple consecutive completed epochs in order', async () => {
    // Arrange
    type EpochType = ReturnType<typeof createMockEpoch> | null;
    const epoch100Promise = createControllablePromise<EpochType>();
    const epoch101Promise = createControllablePromise<EpochType>();
    const epoch102Promise = createControllablePromise<EpochType>();
    const blockingPromise1 = createControllablePromise<EpochType>(); // Blocks at capacity
    const blockingPromise2 = createControllablePromise<EpochType>(); // Blocks after release

    vi.mocked(mockEpochController.getMinEpochToProcessExcluding)
      .mockReturnValueOnce(epoch100Promise.promise)
      .mockReturnValueOnce(epoch101Promise.promise)
      .mockReturnValueOnce(epoch102Promise.promise)
      .mockReturnValueOnce(blockingPromise1.promise) // Blocks when at capacity
      .mockReturnValue(blockingPromise2.promise); // Blocks after release

    const { actor, subscription } = createAndStartActor(
      epochOrchestratorMachine,
      createOrchestratorInput(),
    );

    // Spawn all 3 epochs
    await resolvePromiseAndAdvance(epoch100Promise, createMockEpoch(100));
    await resolvePromiseAndAdvance(epoch101Promise, createMockEpoch(101));
    await resolvePromiseAndAdvance(epoch102Promise, createMockEpoch(102));

    // Machine is now blocked on blockingPromise1 (at capacity)
    let snapshot = actor.getSnapshot();
    expect(Object.keys(snapshot.context.epochs).length).toBe(3);

    // Complete all three epochs - global handler updates context immediately
    actor.send({ type: 'EPOCH_COMPLETED', epoch: 100, machineId: 'epochProcessor:100' });
    actor.send({ type: 'EPOCH_COMPLETED', epoch: 101, machineId: 'epochProcessor:101' });
    actor.send({ type: 'EPOCH_COMPLETED', epoch: 102, machineId: 'epochProcessor:102' });

    // All three should be marked as completed immediately
    snapshot = actor.getSnapshot();
    expect(snapshot.context.epochs[100]).toBe('completed');
    expect(snapshot.context.epochs[101]).toBe('completed');
    expect(snapshot.context.epochs[102]).toBe('completed');

    // Resolve blockingPromise1 to trigger polling -> releasingCompletedEpochs cycle
    await resolvePromiseAndAdvance(blockingPromise1, null);

    // All three should be released since they completed consecutively from the lowest
    snapshot = actor.getSnapshot();
    expect(snapshot.context.epochs[100]).toBeUndefined();
    expect(snapshot.context.epochs[101]).toBeUndefined();
    expect(snapshot.context.epochs[102]).toBeUndefined();
    expect(Object.keys(snapshot.context.epochs).length).toBe(0);

    actor.stop();
    subscription.unsubscribe();
  });
});
