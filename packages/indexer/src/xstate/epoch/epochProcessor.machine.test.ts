import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import ms from 'ms';
import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest';

import {
  createAndStartActor,
  createControllablePromise,
  getLastState,
  getNestedState,
} from '@/src/__tests__/utils.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { MAX_PARALLEL_EPOCHS } from '@/src/xstate/epoch/epochOrchestrator.machine.js';
import { epochProcessorMachine } from '@/src/xstate/epoch/epochProcessor.machine.js';

// ============================================================================
// Test Constants
// ============================================================================
const SLOT_DURATION = ms('10ms');
const SLOTS_PER_EPOCH = 32;
const GENESIS_TIMESTAMP = 1606824000000;
const EPOCHS_PER_SYNC_COMMITTEE_PERIOD = 256;
const SLOT_START_INDEXING = 32;
const EPOCH_100_START_TIME = GENESIS_TIMESTAMP + 100 * SLOTS_PER_EPOCH * 10;
const EPOCH_101_START_TIME = GENESIS_TIMESTAMP + 101 * SLOTS_PER_EPOCH * 10;

// ============================================================================
// Mock Controllers
// ============================================================================
const mockEpochController = {
  upsertCommitteePartitions: vi.fn(),
  fetchCommittees: vi.fn(),
  fetchSyncCommittees: vi.fn(),
  fetchEpochRewards: vi.fn(),
  updateSlotsFetched: vi.fn(),
  markEpochAsProcessed: vi.fn(),
  markValidatorsActivationFetched: vi.fn(),
  isValidatorsBalancesFetched: vi.fn(),
  isRewardsFetched: vi.fn(),
  isValidatorsActivationFetched: vi.fn(),
  getEpochByNumber: vi.fn(),
  isPriorEpochCommitteesReady: vi.fn(),
  isPriorEpochSlotsProcessed: vi.fn(),
} as unknown as EpochController;

const mockValidatorsController = {
  fetchValidatorsState: vi.fn(),
  trackTransitioningValidators: vi.fn(),
  discoverNewValidators: vi.fn(),
} as unknown as ValidatorsController;

const mockSlotController = {} as unknown as SlotController;

// ============================================================================
// Mock slotOrchestratorMachine
// ============================================================================

// Mock that waits for COMPLETE_SLOTS event, then sends SLOTS_COMPLETED to parent
const mockSlotOrchestratorMachine = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setup, sendParent } = require('xstate');

  return setup({
    actions: {
      notifyParentSlotsCompleted: sendParent(({ context }: { context: { epoch: number } }) => ({
        type: 'SLOTS_COMPLETED',
        epoch: context.epoch,
      })),
    },
  }).createMachine({
    id: 'slotOrchestratorMachine',
    initial: 'processing',
    context: ({ input }: { input: { epoch: number } }) => ({
      epoch: input.epoch,
    }),
    states: {
      processing: {
        on: {
          // Send this event to complete slots and notify parent
          COMPLETE_SLOTS: {
            target: 'complete',
          },
        },
      },
      complete: {
        type: 'final',
        entry: 'notifyParentSlotsCompleted',
      },
    },
  });
});

vi.mock('@/src/xstate/slot/slotOrchestrator.machine.js', () => ({
  slotOrchestratorMachine: mockSlotOrchestratorMachine,
}));

vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

vi.mock('@/src/xstate/multiMachineLogger.js', () => ({
  logActor: vi.fn(),
}));

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reset all mocks to default successful behavior
 */
function resetMocks() {
  vi.clearAllMocks();
  (mockEpochController.fetchCommittees as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockEpochController.getEpochByNumber as ReturnType<typeof vi.fn>).mockResolvedValue({
    committeesFetched: true,
  });
  (mockEpochController.isPriorEpochCommitteesReady as ReturnType<typeof vi.fn>).mockResolvedValue(
    true,
  );
  (mockEpochController.isPriorEpochSlotsProcessed as ReturnType<typeof vi.fn>).mockResolvedValue(
    true,
  );
  (mockEpochController.fetchSyncCommittees as ReturnType<typeof vi.fn>).mockResolvedValue(
    undefined,
  );
  (mockEpochController.fetchEpochRewards as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockEpochController.updateSlotsFetched as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockEpochController.markEpochAsProcessed as ReturnType<typeof vi.fn>).mockResolvedValue(
    undefined,
  );
  (
    mockEpochController.markValidatorsActivationFetched as ReturnType<typeof vi.fn>
  ).mockResolvedValue(undefined);
  (mockValidatorsController.fetchValidatorsState as ReturnType<typeof vi.fn>).mockResolvedValue(
    undefined,
  );
  (
    mockValidatorsController.trackTransitioningValidators as ReturnType<typeof vi.fn>
  ).mockResolvedValue(undefined);
}

/**
 * Create BeaconTime instance with test constants
 */
function createMockBeaconTime() {
  return new BeaconTime({
    genesisTimestamp: GENESIS_TIMESTAMP,
    slotDurationMs: SLOT_DURATION,
    slotsPerEpoch: SLOTS_PER_EPOCH,
    epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
    lookbackSlot: SLOT_START_INDEXING,
  });
}

/**
 * Create default input for epoch processor machine
 */
function createProcessorMachineDefaultInput(
  epoch: number,
  overrides?: {
    beaconTime?: BeaconTime;
  },
) {
  return {
    epoch,
    config: {
      slotDuration: SLOT_DURATION,
      slotsPerEpoch: SLOTS_PER_EPOCH,
      lookbackSlot: SLOT_START_INDEXING,
      maxParallelEpochs: MAX_PARALLEL_EPOCHS,
    },
    services: {
      beaconTime: overrides?.beaconTime || createMockBeaconTime(),
      epochController: mockEpochController,
      validatorsController: mockValidatorsController,
      slotController: mockSlotController,
    },
  };
}

/**
 * Wait for XState to process transitions by allowing multiple event loop ticks
 * This is needed because XState requires multiple microtask ticks to process transitions
 */
async function waitForXStateTransitions() {
  // Allow XState to process transitions by giving multiple event loop ticks
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ============================================================================
// Tests
// ============================================================================

describe('epochProcessorMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  describe('waitingToProcessEpoch', () => {
    test('cannot process epoch (too early), should wait until ready', async () => {
      const { actor, stateTransitions, subscription } = createAndStartActor(
        epochProcessorMachine,
        createProcessorMachineDefaultInput(100),
        {
          canProcessEpoch: () => false,
        },
      );

      // Initial state should be waitingToProcessEpoch
      expect(stateTransitions[0]).toBe('waitingToProcessEpoch');

      // After timers run, should still be waiting (invoke will wait)
      vi.runOnlyPendingTimers();
      // Single tick to allow XState to process, but not enough for invoke to complete
      await Promise.resolve();

      // Should still be in waitingToProcessEpoch (waiting for timeout)
      expect(stateTransitions[stateTransitions.length - 1]).toBe('waitingToProcessEpoch');

      actor.stop();
      subscription.unsubscribe();
    });

    test('can process next epoch (1 epoch in advance), should go directly to epochProcessing', async () => {
      // Current epoch is 100, we want to process epoch 101 (one epoch ahead)
      vi.setSystemTime(new Date(EPOCH_100_START_TIME + SLOT_DURATION));

      const { actor, stateTransitions, subscription } = createAndStartActor(
        epochProcessorMachine,
        createProcessorMachineDefaultInput(101),
      );

      // Initial snapshot should be waitingToProcessEpoch
      expect(stateTransitions[0]).toBe('waitingToProcessEpoch');

      // Wait for the invoke to resolve (it resolves immediately if slot already passed)
      vi.runOnlyPendingTimers();
      await waitForXStateTransitions();

      // Next snapshot should be epochProcessing (invoke resolves immediately if already ready)
      expect(stateTransitions.length).toBeGreaterThan(1);
      expect(typeof stateTransitions[stateTransitions.length - 1]).toBe('object');
      expect(stateTransitions[stateTransitions.length - 1]).toHaveProperty('epochProcessing');

      actor.stop();
      subscription.unsubscribe();
    });
  });

  describe('epochProcessing', () => {
    describe('monitoringEpochStart', () => {
      test('epoch already started, should go directly to epochStarted', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Get last epochProcessing state
        const lastState = getLastState(stateTransitions);
        const monitoringState = getNestedState(
          lastState,
          'epochProcessing.monitoringEpochStart',
        ) as string | null;
        expect(monitoringState).toBe('epochStarted');

        actor.stop();
        subscription.unsubscribe();
      });

      test('epoch not started, should wait and then complete', async () => {
        vi.setSystemTime(new Date(EPOCH_100_START_TIME - 100));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        // Run all timers so that internal time-based transitions (including waitForEpochStart)
        // are executed, allowing the monitoring state machine to progress through to epochStarted.
        await vi.runAllTimersAsync();

        // Collect monitoring substate transitions
        const monitoringStates = stateTransitions
          .map((s) => getNestedState(s, 'epochProcessing.monitoringEpochStart') as string | null)
          .filter((s) => s !== null);

        const waitingIndex = monitoringStates.indexOf('waitingForEpochStart');
        const startedIndex = monitoringStates.indexOf('epochStarted');

        expect(waitingIndex).toBeGreaterThanOrEqual(0);
        expect(startedIndex).toBeGreaterThan(waitingIndex);

        actor.stop();
        subscription.unsubscribe();
      });

      test('epoch start respects delaySlotsToHead (waits until effective start)', async () => {
        const beaconTimeWithDelay = new BeaconTime({
          genesisTimestamp: GENESIS_TIMESTAMP,
          slotDurationMs: SLOT_DURATION,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
          lookbackSlot: SLOT_START_INDEXING,
          delaySlotsToHead: 4,
        });

        // Time is after nominal epoch start but before effective start (startSlot + delay)
        vi.setSystemTime(new Date(EPOCH_100_START_TIME + SLOT_DURATION));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100, { beaconTime: beaconTimeWithDelay }),
        );

        await vi.runAllTimersAsync();

        // Collect monitoring substate transitions
        const monitoringStates = stateTransitions
          .map((s) => getNestedState(s, 'epochProcessing.monitoringEpochStart') as string | null)
          .filter((s) => s !== null);

        const waitingIndex = monitoringStates.indexOf('waitingForEpochStart');
        const startedIndex = monitoringStates.indexOf('epochStarted');

        expect(waitingIndex).toBeGreaterThanOrEqual(0);
        expect(startedIndex).toBeGreaterThan(waitingIndex);

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('committees', () => {
      test('should process and complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const fetchPromise = createControllablePromise<void>();
        (mockEpochController.fetchCommittees as ReturnType<typeof vi.fn>).mockReturnValue(
          fetchPromise.promise,
        );

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be in fetchingCommittees state
        let lastState = getLastState(stateTransitions);
        let committeesState = getNestedState(lastState, 'epochProcessing.fetching.committees') as
          | string
          | null;
        expect(committeesState).toBe('fetchingCommittees');

        // Complete the fetch
        fetchPromise.resolve();
        await vi.runAllTimersAsync();

        // Should be complete
        lastState = getLastState(stateTransitions);
        committeesState = getNestedState(lastState, 'epochProcessing.fetching.committees') as
          | string
          | null;
        expect(committeesState).toBe('committeesFetched');
        expect(mockEpochController.fetchCommittees).toHaveBeenCalledWith(100);

        actor.stop();
        subscription.unsubscribe();
      });

      test('should emit COMMITTEES_FETCHED on complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const { actor, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Committees should be marked as fetched in sync state
        expect(actor.getSnapshot().context.sync.committeesFetched).toBe(true);

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('syncingCommittees', () => {
      test('should process and complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const fetchPromise = createControllablePromise<void>();
        (mockEpochController.fetchSyncCommittees as ReturnType<typeof vi.fn>).mockReturnValue(
          fetchPromise.promise,
        );

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be processing
        let lastState = getLastState(stateTransitions);
        let syncState = getNestedState(lastState, 'epochProcessing.fetching.syncingCommittees') as
          | string
          | null;
        expect(syncState).toBe('fetchingSyncCommittees');

        // Complete the fetch
        fetchPromise.resolve();
        await vi.runAllTimersAsync();

        // Should be complete
        lastState = getLastState(stateTransitions);
        syncState = getNestedState(lastState, 'epochProcessing.fetching.syncingCommittees') as
          | string
          | null;
        expect(syncState).toBe('syncCommitteesFetched');
        expect(mockEpochController.fetchSyncCommittees).toHaveBeenCalledWith(100);

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('slotsProcessing', () => {
      test('should wait for prior epoch committees before processing', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        // Block fetchCommittees so the committees branch doesn't complete immediately
        const committeesPromise = createControllablePromise<void>();
        (mockEpochController.fetchCommittees as ReturnType<typeof vi.fn>).mockReturnValue(
          committeesPromise.promise,
        );

        // Initially, prior epoch committees are not ready
        let priorEpochCommitteesReady = false;
        (
          mockEpochController.isPriorEpochCommitteesReady as ReturnType<typeof vi.fn>
        ).mockImplementation(() => Promise.resolve(priorEpochCommitteesReady));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        // Advance time to let the actor check prior epoch and enter retry loop
        await vi.advanceTimersByTimeAsync(100);

        // Should be retrying prior epoch check (prior epoch N-1 committees not ready)
        let lastState = getLastState(stateTransitions);
        let slotsState = getNestedState(lastState, 'epochProcessing.fetching.slotsProcessing') as
          | string
          | null;
        expect(slotsState).toBe('retryingPriorEpochDependencies');

        // Simulate prior epoch committees becoming ready and resolve current epoch committees
        priorEpochCommitteesReady = true;
        committeesPromise.resolve();

        // Advance past retry delay (slotDuration/2 = 5ms) and let transitions settle
        await vi.advanceTimersByTimeAsync(100);

        // Should now be running the slots orchestrator
        lastState = getLastState(stateTransitions);
        slotsState = getNestedState(lastState, 'epochProcessing.fetching.slotsProcessing') as
          | string
          | null;
        expect(slotsState).toBe('runningSlotsOrchestrator');

        // Verify isPriorEpochCommitteesReady was called with the lookbackEpoch derived from lookbackSlot
        const lookbackEpoch = Math.floor(SLOT_START_INDEXING / SLOTS_PER_EPOCH);
        expect(mockEpochController.isPriorEpochCommitteesReady).toHaveBeenCalledWith(
          100,
          lookbackEpoch,
        );

        actor.stop();
        subscription.unsubscribe();
      });

      test('should spawn slot orchestrator and handle SLOTS_COMPLETED lifecycle', async () => {
        vi.setSystemTime(new Date(EPOCH_100_START_TIME + 50));

        // Keep fetchEpochRewards pending to prevent the machine from completing and attempting sendParent
        const rewardsPromise = createControllablePromise<void>();
        (mockEpochController.fetchEpochRewards as ReturnType<typeof vi.fn>).mockReturnValue(
          rewardsPromise.promise,
        );

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        // Wait for committees to be ready and slots to start processing
        await vi.runAllTimersAsync();

        // Complete upsert and committees to allow slots to start processing
        // (they are auto-resolved by resetMocks, but we need to wait for them)
        await vi.runAllTimersAsync();

        const lastState = getLastState(stateTransitions);
        const slotsState = getNestedState(lastState, 'epochProcessing.fetching.slotsProcessing') as
          | string
          | null;

        // Should be running the orchestrator now
        expect(slotsState).toBe('runningSlotsOrchestrator');

        // Get current snapshot to access slot orchestrator
        const currentSnapshot = actor.getSnapshot();

        // Should have spawned the orchestrator
        expect(currentSnapshot.context.actors.slotOrchestratorActor).toBeTruthy();

        // Verify committees were fetched for this epoch
        expect(mockEpochController.fetchCommittees).toHaveBeenCalledWith(100);

        // Simulate SLOTS_COMPLETED from child
        actor.send({ type: 'SLOTS_COMPLETED', epoch: 100 });
        await vi.runAllTimersAsync();

        // Verify lifecycle states in order
        const slotsStates = stateTransitions
          .map(
            (s) => getNestedState(s, 'epochProcessing.fetching.slotsProcessing') as string | null,
          )
          .filter((s) => s !== null);

        const priorEpochIndex = slotsStates.indexOf('waitingForPriorEpochDependencies');
        const waitingIndex = slotsStates.indexOf('waitingForCommittees');
        const waitingForSlotsIndex = slotsStates.indexOf('waitingForPriorEpochSlots');
        const runningIndex = slotsStates.indexOf('runningSlotsOrchestrator');
        const updatingIndex = slotsStates.indexOf('updatingSlotsFetched');
        const processedIndex = slotsStates.indexOf('slotsProcessed');

        expect(priorEpochIndex).toBeGreaterThanOrEqual(0);
        expect(waitingIndex).toBeGreaterThan(priorEpochIndex);
        expect(waitingForSlotsIndex).toBeGreaterThan(waitingIndex);
        expect(runningIndex).toBeGreaterThan(waitingForSlotsIndex);
        expect(updatingIndex).toBeGreaterThan(runningIndex);
        expect(processedIndex).toBeGreaterThan(updatingIndex);

        // updateSlotsFetched should have been called
        expect(mockEpochController.updateSlotsFetched).toHaveBeenCalledWith(100);

        // Slot orchestrator actor should be cleared from context
        expect(actor.getSnapshot().context.actors.slotOrchestratorActor).toBeNull();

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('trackingValidatorsActivation', () => {
      test('should wait for epoch start', async () => {
        // Scenario: epoch has not started yet, machine should wait before discovering/tracking validators
        vi.setSystemTime(new Date(EPOCH_100_START_TIME - 100));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        // Wait for the machine to transition to epochProcessing
        vi.runOnlyPendingTimers();
        await waitForXStateTransitions();

        // Should be waiting for epoch start
        const lastState = getLastState(stateTransitions);
        const activationState = getNestedState(
          lastState,
          'epochProcessing.fetching.trackingValidatorsActivation',
        ) as string | null;
        expect(activationState).toBe('waitingForEpochStart');

        actor.stop();
        subscription.unsubscribe();
      });

      test('epoch started, should discover new validators then track transitions', async () => {
        // Scenario: epoch already started, machine should first discover new validators,
        // then track state transitions for pending validators
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        // Mock discoverNewValidators to resolve immediately
        const discoveryPromise = createControllablePromise<void>();
        (
          mockValidatorsController.discoverNewValidators as ReturnType<typeof vi.fn>
        ).mockReturnValue(discoveryPromise.promise);

        const trackingPromise = createControllablePromise<void>();
        (
          mockValidatorsController.trackTransitioningValidators as ReturnType<typeof vi.fn>
        ).mockReturnValue(trackingPromise.promise);

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be discovering new validators first
        let lastState = getLastState(stateTransitions);
        let activationState = getNestedState(
          lastState,
          'epochProcessing.fetching.trackingValidatorsActivation',
        ) as string | null;
        expect(activationState).toBe('discoveringNewValidators');
        expect(mockValidatorsController.discoverNewValidators).toHaveBeenCalled();

        // Complete discovery, should move to tracking activation
        discoveryPromise.resolve();
        await vi.runAllTimersAsync();

        lastState = getLastState(stateTransitions);
        activationState = getNestedState(
          lastState,
          'epochProcessing.fetching.trackingValidatorsActivation',
        ) as string | null;
        expect(activationState).toBe('trackingActivation');

        // Complete tracking
        trackingPromise.resolve();
        await vi.runAllTimersAsync();

        // Should be complete
        lastState = getLastState(stateTransitions);
        activationState = getNestedState(
          lastState,
          'epochProcessing.fetching.trackingValidatorsActivation',
        ) as string | null;
        expect(activationState).toBe('activationTracked');
        expect(mockValidatorsController.trackTransitioningValidators).toHaveBeenCalled();

        actor.stop();
        subscription.unsubscribe();
      });

      test('discovery failure should not block tracking activation', async () => {
        // Scenario: discovering new validators fails, but the machine should still
        // proceed to track transitioning validators (graceful degradation)
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        // Mock discoverNewValidators to reject
        (
          mockValidatorsController.discoverNewValidators as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error('beacon node timeout'));

        const trackingPromise = createControllablePromise<void>();
        (
          mockValidatorsController.trackTransitioningValidators as ReturnType<typeof vi.fn>
        ).mockReturnValue(trackingPromise.promise);

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Despite discovery failure, should proceed to tracking activation
        let lastState = getLastState(stateTransitions);
        let activationState = getNestedState(
          lastState,
          'epochProcessing.fetching.trackingValidatorsActivation',
        ) as string | null;
        expect(activationState).toBe('trackingActivation');

        // Complete tracking
        trackingPromise.resolve();
        await vi.runAllTimersAsync();

        // Should be complete
        lastState = getLastState(stateTransitions);
        activationState = getNestedState(
          lastState,
          'epochProcessing.fetching.trackingValidatorsActivation',
        ) as string | null;
        expect(activationState).toBe('activationTracked');

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('validatorsBalances', () => {
      test('should wait for epoch start', async () => {
        vi.setSystemTime(new Date(EPOCH_100_START_TIME - 100));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        // Wait for the machine to transition to epochProcessing
        vi.runOnlyPendingTimers();
        await waitForXStateTransitions();

        // Should be waiting for epoch start
        const lastState = getLastState(stateTransitions);
        const balancesState = getNestedState(
          lastState,
          'epochProcessing.fetching.validatorsBalances',
        ) as string | null;
        expect(balancesState).toBe('waitingForEpochStart');

        actor.stop();
        subscription.unsubscribe();
      });

      test('epoch started, not fetched, should process and complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const balancesPromise = createControllablePromise<void>();
        (mockValidatorsController.fetchValidatorsState as ReturnType<typeof vi.fn>).mockReturnValue(
          balancesPromise.promise,
        );

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be processing
        let lastState = getLastState(stateTransitions);
        let balancesState = getNestedState(
          lastState,
          'epochProcessing.fetching.validatorsBalances',
        ) as string | null;
        expect(balancesState).toBe('fetchingValidatorsBalances');

        // Complete balances fetch
        balancesPromise.resolve();
        await vi.runAllTimersAsync();

        // Should be complete
        lastState = getLastState(stateTransitions);
        balancesState = getNestedState(lastState, 'epochProcessing.fetching.validatorsBalances') as
          | string
          | null;
        expect(balancesState).toBe('validatorsBalancesFetched');
        expect(mockValidatorsController.fetchValidatorsState).toHaveBeenCalled();

        actor.stop();
        subscription.unsubscribe();
      });

      test('should emit VALIDATORS_BALANCES_FETCHED on complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const { actor, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Balances should be marked as fetched in sync state
        expect(actor.getSnapshot().context.sync.validatorsBalancesFetched).toBe(true);

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('rewards', () => {
      test('should wait for validators balances', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const balancesPromise = createControllablePromise<void>();
        (mockValidatorsController.fetchValidatorsState as ReturnType<typeof vi.fn>).mockReturnValue(
          balancesPromise.promise,
        );

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be waiting for balances
        const lastState = getLastState(stateTransitions);
        const rewardsState = getNestedState(lastState, 'epochProcessing.fetching.rewards') as
          | string
          | null;
        expect(rewardsState).toBe('waitingForBalances');

        actor.stop();
        subscription.unsubscribe();
      });

      test('balances ready and epoch ended, should process rewards after prerequisites', async () => {
        // Set time after epoch has ended
        const epochEndTime = EPOCH_101_START_TIME + SLOTS_PER_EPOCH * SLOT_DURATION + 100;
        vi.setSystemTime(new Date(epochEndTime));

        (mockEpochController.fetchEpochRewards as ReturnType<typeof vi.fn>).mockResolvedValue(
          undefined,
        );

        const { actor, stateTransitions, subscription } = createAndStartActor(
          epochProcessorMachine,
          createProcessorMachineDefaultInput(100),
          {
            areValidatorsBalancesFetched: () => true,
          },
        );

        await vi.runAllTimersAsync();

        // Collect rewards substates in order
        const rewardsStates = stateTransitions
          .map((s) => getNestedState(s, 'epochProcessing.fetching.rewards') as string | null)
          .filter((s) => s !== null);

        const fetchingRewardsIndex = rewardsStates.indexOf('fetchingRewards');
        const rewardsFetchedIndex = rewardsStates.indexOf('rewardsFetched');

        // Depending on timing and guards, we may not observe waitingForEpochEnd
        // as a stable snapshot. We only require that rewards are fetched in order.
        expect(fetchingRewardsIndex).toBeGreaterThanOrEqual(0);
        expect(rewardsFetchedIndex).toBeGreaterThan(fetchingRewardsIndex);

        // Controller should have been called once prerequisites were met
        expect(mockEpochController.fetchEpochRewards).toHaveBeenCalledWith(100);

        actor.stop();
        subscription.unsubscribe();
      });
    });
  });

  describe('markingEpochProcessed', () => {
    test('should mark epoch as processed and send EPOCH_COMPLETED to parent', async () => {
      // Set time after epoch has ended so all time-based waits resolve immediately
      const epochEndTime = EPOCH_101_START_TIME + SLOTS_PER_EPOCH * SLOT_DURATION + 100;
      vi.setSystemTime(new Date(epochEndTime));

      // Create a parent machine that spawns the epochProcessorMachine
      // This allows us to test sendParent behavior
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { setup, createActor } = require('xstate');

      let receivedEpochCompleted = false;
      let completedMachineId = '';

      const mockEpochOrchestratorMachine = setup({
        actors: {
          epochProcessor: epochProcessorMachine,
        },
      }).createMachine({
        id: 'testParent',
        initial: 'running',
        states: {
          running: {
            invoke: {
              id: 'epochProcessor',
              src: 'epochProcessor',
              input: createProcessorMachineDefaultInput(100),
            },
            on: {
              EPOCH_COMPLETED: {
                target: 'completed',
                actions: ({ event }: { event: { type: string; machineId: string } }) => {
                  receivedEpochCompleted = true;
                  completedMachineId = event.machineId;
                },
              },
            },
          },
          completed: {
            type: 'final',
          },
        },
      });

      const parentActor = createActor(mockEpochOrchestratorMachine);
      parentActor.start();

      // Let the machine start processing
      await vi.runAllTimersAsync();

      // Get the spawned slot orchestrator and send COMPLETE_SLOTS to trigger SLOTS_COMPLETED
      const epochProcessorActor = parentActor.getSnapshot().children.epochProcessor;
      const slotOrchestratorActor =
        epochProcessorActor?.getSnapshot().context.actors.slotOrchestratorActor;
      slotOrchestratorActor?.send({ type: 'COMPLETE_SLOTS' });

      // Run remaining timers to complete the epoch lifecycle
      await vi.runAllTimersAsync();

      // Verify all controllers were called with correct epoch
      expect(mockEpochController.fetchCommittees).toHaveBeenCalledWith(100);
      expect(mockEpochController.fetchSyncCommittees).toHaveBeenCalledWith(100);
      expect(mockEpochController.updateSlotsFetched).toHaveBeenCalledWith(100);
      expect(mockEpochController.fetchEpochRewards).toHaveBeenCalledWith(100);
      expect(mockEpochController.markEpochAsProcessed).toHaveBeenCalledWith(100);
      expect(mockValidatorsController.fetchValidatorsState).toHaveBeenCalled();
      expect(mockValidatorsController.trackTransitioningValidators).toHaveBeenCalled();

      // Verify EPOCH_COMPLETED was sent to parent with correct machineId
      expect(receivedEpochCompleted).toBe(true);
      expect(completedMachineId).toBe('epochProcessor:100');

      // Verify parent reached completed state (proves the full lifecycle worked)
      expect(parentActor.getSnapshot().value).toBe('completed');

      parentActor.stop();
    });
  });
});
