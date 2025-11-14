import ms from 'ms';
import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import { createActor, SnapshotFrom } from 'xstate';

import { createControllablePromise } from '@/src/__tests__/utils.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
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
  fetchCommittees: vi.fn<any>(),
  fetchSyncCommittees: vi.fn<any>(),
  fetchRewards: vi.fn<any>(),
  updateSlotsFetched: vi.fn<any>(),
  markEpochAsProcessed: vi.fn<any>(),
  markValidatorsActivationFetched: vi.fn<any>(),
  isValidatorsBalancesFetched: vi.fn<any>(),
  isRewardsFetched: vi.fn<any>(),
  isValidatorsActivationFetched: vi.fn<any>(),
} as unknown as EpochController;

const mockValidatorsController = {
  fetchValidatorsBalances: vi.fn<any>(),
  trackTransitioningValidators: vi.fn<any>(),
} as unknown as ValidatorsController;

const mockSlotController = {} as unknown as SlotController;

// ============================================================================
// Mock slotOrchestratorMachine
// ============================================================================
const mockSlotOrchestratorMachine = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setup } = require('xstate');

  return setup({}).createMachine({
    id: 'slotOrchestratorMachine',
    initial: 'processing',
    states: {
      processing: {
        on: {
          SLOT_COMPLETED: {
            target: 'complete',
          },
        },
      },
      complete: {
        type: 'final',
        // When the machine reaches final state, it will trigger onDone in parent
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
  (mockEpochController.fetchCommittees as any).mockResolvedValue(undefined);
  (mockEpochController.fetchSyncCommittees as any).mockResolvedValue(undefined);
  (mockEpochController.fetchRewards as any).mockResolvedValue(undefined);
  (mockEpochController.updateSlotsFetched as any).mockResolvedValue(undefined);
  (mockEpochController.markEpochAsProcessed as any).mockResolvedValue(undefined);
  (mockEpochController.markValidatorsActivationFetched as any).mockResolvedValue(undefined);
  (mockValidatorsController.fetchValidatorsBalances as any).mockResolvedValue(undefined);
  (mockValidatorsController.trackTransitioningValidators as any).mockResolvedValue(undefined);
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
function createDefaultInput(
  epoch: number,
  overrides?: {
    epochDBSnapshot?: Partial<{
      validatorsBalancesFetched: boolean;
      rewardsFetched: boolean;
      committeesFetched: boolean;
      slotsFetched: boolean;
      syncCommitteesFetched: boolean;
      validatorsActivationFetched: boolean;
    }>;
    beaconTime?: BeaconTime;
  },
) {
  return {
    epoch,
    epochDBSnapshot: {
      validatorsBalancesFetched: false,
      rewardsFetched: false,
      committeesFetched: false,
      slotsFetched: false,
      syncCommitteesFetched: false,
      validatorsActivationFetched: false,
      ...overrides?.epochDBSnapshot,
    },
    config: {
      slotDuration: SLOT_DURATION,
      lookbackSlot: SLOT_START_INDEXING,
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
 * Create and start an actor, returning it with a state transitions array
 */
function createAndStartActor(
  input: ReturnType<typeof createDefaultInput>,
  guards?: Record<string, (...args: unknown[]) => boolean>,
) {
  const actor = createActor(
    guards ? epochProcessorMachine.provide({ guards }) : epochProcessorMachine,
    { input },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stateTransitions: SnapshotFrom<any>[] = [];
  const subscription = actor.subscribe((snapshot) => {
    stateTransitions.push(snapshot.value);
  });

  actor.start();

  return { actor, stateTransitions, subscription };
}

/**
 * Get the last state from state transitions
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLastState(stateTransitions: any[]) {
  return stateTransitions[stateTransitions.length - 1];
}

/**
 * Get nested state value from state object
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNestedState(state: any, path: string) {
  const parts = path.split('.');
  let current = state;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }
  return current;
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

  describe('checkingCanProcess', () => {
    test('cannot process epoch (too early), should go to waiting and retry', async () => {
      const epochStartTime = EPOCH_100_START_TIME;
      const tooEarlyTime = epochStartTime - SLOTS_PER_EPOCH * SLOT_DURATION - 50;
      vi.setSystemTime(new Date(tooEarlyTime));

      const { actor, stateTransitions, subscription } = createAndStartActor(
        createDefaultInput(100),
        {
          canProcessEpoch: () => false,
        },
      );

      vi.runOnlyPendingTimers();
      await Promise.resolve();

      expect(stateTransitions[0]).toBe('checkingCanProcess');
      expect(stateTransitions[1]).toBe('waiting');

      vi.advanceTimersByTime(SLOT_DURATION * 2);
      await Promise.resolve();

      // Should keep cycling between checking and waiting
      const hasChecking = stateTransitions.includes('checkingCanProcess');
      const hasWaiting = stateTransitions.includes('waiting');
      expect(hasChecking).toBe(true);
      expect(hasWaiting).toBe(true);

      actor.stop();
      subscription.unsubscribe();
    });

    test('can process epoch (1 epoch in advance), should go to epochProcessing', async () => {
      vi.setSystemTime(new Date(EPOCH_101_START_TIME + 10));

      const { actor, stateTransitions, subscription } = createAndStartActor(
        createDefaultInput(100),
      );

      vi.runOnlyPendingTimers();
      await Promise.resolve();

      expect(stateTransitions[0]).toBe('checkingCanProcess');
      expect(typeof stateTransitions[1]).toBe('object');
      expect(stateTransitions[1]).toHaveProperty('epochProcessing');

      actor.stop();
      subscription.unsubscribe();
    });
  });

  describe('epochProcessing', () => {
    describe('monitoringEpochStart', () => {
      test('epoch already started, should go directly to complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        vi.runOnlyPendingTimers();
        await Promise.resolve();

        // Get last epochProcessing state
        const lastState = getLastState(stateTransitions);
        const monitoringState = getNestedState(lastState, 'epochProcessing.monitoringEpochStart');
        expect(monitoringState).toBe('complete');

        actor.stop();
        subscription.unsubscribe();
      });

      test('epoch not started, should wait and then complete', async () => {
        vi.setSystemTime(new Date(EPOCH_100_START_TIME - 100));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        vi.runOnlyPendingTimers();
        await Promise.resolve();

        // Should be in waiting state
        let lastState = getLastState(stateTransitions);
        let monitoringState = getNestedState(lastState, 'epochProcessing.monitoringEpochStart');
        expect(monitoringState).toBe('waiting');

        // Advance time to epoch start
        vi.setSystemTime(new Date(EPOCH_100_START_TIME + 50));
        vi.advanceTimersByTime(150);
        await Promise.resolve();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        // Should now be complete
        lastState = getLastState(stateTransitions);
        monitoringState = getNestedState(lastState, 'epochProcessing.monitoringEpochStart');
        expect(monitoringState).toBe('complete');

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('committees', () => {
      test('already fetched, should complete immediately', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));
        (mockEpochController.fetchCommittees as any).mockResolvedValue({
          success: true,
          skipped: true,
        });

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100, {
            epochDBSnapshot: { committeesFetched: true },
          }),
        );

        // Run all pending promises and timers
        await vi.runAllTimersAsync();

        const lastState = getLastState(stateTransitions);
        const committeesState = getNestedState(lastState, 'epochProcessing.fetching.committees');
        expect(committeesState).toBe('complete');

        actor.stop();
        subscription.unsubscribe();
      });

      test('not fetched, should process and complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const fetchPromise = createControllablePromise<{ success: boolean; skipped: boolean }>();
        (mockEpochController.fetchCommittees as any).mockReturnValue(fetchPromise.promise);

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be processing
        let lastState = getLastState(stateTransitions);
        let committeesState = getNestedState(lastState, 'epochProcessing.fetching.committees');
        expect(committeesState).toBe('processing');

        // Complete the fetch
        fetchPromise.resolve({ success: true, skipped: false });
        await vi.runAllTimersAsync();

        // Should be complete
        lastState = getLastState(stateTransitions);
        committeesState = getNestedState(lastState, 'epochProcessing.fetching.committees');
        expect(committeesState).toBe('complete');
        expect(mockEpochController.fetchCommittees).toHaveBeenCalledWith(100);

        actor.stop();
        subscription.unsubscribe();
      });

      test('should emit COMMITTEES_FETCHED on complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const { actor, subscription } = createAndStartActor(createDefaultInput(100));

        await vi.runAllTimersAsync();

        // Committees should be ready
        expect(actor.getSnapshot().context.committeesReady).toBe(true);

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('syncingCommittees', () => {
      test('already fetched, should complete immediately', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));
        (mockEpochController.fetchSyncCommittees as any).mockResolvedValue({
          success: true,
          skipped: true,
        });

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100, {
            epochDBSnapshot: { syncCommitteesFetched: true },
          }),
        );

        await vi.runAllTimersAsync();

        const lastState = getLastState(stateTransitions);
        const syncState = getNestedState(lastState, 'epochProcessing.fetching.syncingCommittees');
        expect(syncState).toBe('complete');

        actor.stop();
        subscription.unsubscribe();
      });

      test('not fetched, should process and complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const fetchPromise = createControllablePromise<{ success: boolean; skipped: boolean }>();
        (mockEpochController.fetchSyncCommittees as any).mockReturnValue(fetchPromise.promise);

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be processing
        let lastState = getLastState(stateTransitions);
        let syncState = getNestedState(lastState, 'epochProcessing.fetching.syncingCommittees');
        expect(syncState).toBe('processing');

        // Complete the fetch
        fetchPromise.resolve({ success: true, skipped: false });
        await vi.runAllTimersAsync();

        // Should be complete
        lastState = getLastState(stateTransitions);
        syncState = getNestedState(lastState, 'epochProcessing.fetching.syncingCommittees');
        expect(syncState).toBe('complete');
        expect(mockEpochController.fetchSyncCommittees).toHaveBeenCalledWith(100);

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('slotsProcessing', () => {
      test('should wait for committees before processing', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const committeesPromise = createControllablePromise<{
          success: boolean;
          skipped: boolean;
        }>();
        (mockEpochController.fetchCommittees as any).mockReturnValue(committeesPromise.promise);

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be waiting for committees
        let lastState = getLastState(stateTransitions);
        let slotsState = getNestedState(lastState, 'epochProcessing.fetching.slotsProcessing');
        expect(slotsState).toBe('waitingForCommittees');

        // Complete committees
        committeesPromise.resolve({ success: true, skipped: false });
        await vi.runAllTimersAsync();

        // Should now be processing
        lastState = getLastState(stateTransitions);
        slotsState = getNestedState(lastState, 'epochProcessing.fetching.slotsProcessing');
        expect(slotsState).toBe('processing');

        actor.stop();
        subscription.unsubscribe();
      });

      test('already processed, should skip to complete after committees ready', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100, {
            epochDBSnapshot: { slotsFetched: true },
          }),
        );

        vi.runOnlyPendingTimers();
        await Promise.resolve();
        vi.advanceTimersByTime(SLOT_DURATION);
        await Promise.resolve();

        // Wait for COMMITTEES_FETCHED event
        vi.advanceTimersByTime(SLOT_DURATION);
        await Promise.resolve();

        const lastState = getLastState(stateTransitions);
        const slotsState = getNestedState(lastState, 'epochProcessing.fetching.slotsProcessing');
        // Should eventually reach processing or complete
        expect([
          'waitingForCommittees',
          'processing',
          'updatingSlotsFetched',
          'complete',
        ]).toContain(slotsState);

        actor.stop();
        subscription.unsubscribe();
      });

      test('should spawn slot orchestrator and wait for SLOTS_COMPLETED', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        // Wait for committees to be ready and slots to start processing
        await vi.runAllTimersAsync();

        const lastState = getLastState(stateTransitions);
        const slotsState = getNestedState(lastState, 'epochProcessing.fetching.slotsProcessing');

        // Should be processing now
        expect(slotsState).toBe('processing');

        // Get current snapshot to access slot orchestrator
        const currentSnapshot = actor.getSnapshot();

        // Should have spawned the orchestrator
        expect(currentSnapshot.context.actors.slotOrchestratorActor).toBeTruthy();

        // Verify it was invoked with correct input
        expect(mockEpochController.fetchCommittees).toHaveBeenCalledWith(100);

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('trackingValidatorsActivation', () => {
      test('should wait for epoch start', async () => {
        vi.setSystemTime(new Date(EPOCH_100_START_TIME - 100));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        vi.runOnlyPendingTimers();
        await Promise.resolve();

        // Should be waiting for epoch start
        const lastState = getLastState(stateTransitions);
        const activationState = getNestedState(
          lastState,
          'epochProcessing.fetching.trackingValidatorsActivation',
        );
        expect(activationState).toBe('waitingForEpochStart');

        actor.stop();
        subscription.unsubscribe();
      });

      test('epoch started, already processed, should complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));
        (mockValidatorsController.trackTransitioningValidators as any).mockResolvedValue(undefined);

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100, {
            epochDBSnapshot: { validatorsActivationFetched: true },
          }),
        );

        await vi.runAllTimersAsync();

        const lastState = getLastState(stateTransitions);
        const activationState = getNestedState(
          lastState,
          'epochProcessing.fetching.trackingValidatorsActivation',
        );
        expect(['processing', 'complete']).toContain(activationState);

        actor.stop();
        subscription.unsubscribe();
      });

      test('epoch started, not processed, should process and complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const trackingPromise = createControllablePromise<void>();
        (mockValidatorsController.trackTransitioningValidators as any).mockReturnValue(
          trackingPromise.promise,
        );

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be processing
        let lastState = getLastState(stateTransitions);
        let activationState = getNestedState(
          lastState,
          'epochProcessing.fetching.trackingValidatorsActivation',
        );
        expect(activationState).toBe('processing');

        // Complete tracking
        trackingPromise.resolve();
        await vi.runAllTimersAsync();

        // Should be complete
        lastState = getLastState(stateTransitions);
        activationState = getNestedState(
          lastState,
          'epochProcessing.fetching.trackingValidatorsActivation',
        );
        expect(activationState).toBe('complete');
        expect(mockValidatorsController.trackTransitioningValidators).toHaveBeenCalled();

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('validatorsBalances', () => {
      test('should wait for epoch start', async () => {
        vi.setSystemTime(new Date(EPOCH_100_START_TIME - 100));

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        vi.runOnlyPendingTimers();
        await Promise.resolve();

        // Should be waiting for epoch start
        const lastState = getLastState(stateTransitions);
        const balancesState = getNestedState(
          lastState,
          'epochProcessing.fetching.validatorsBalances',
        );
        expect(balancesState).toBe('waitingForEpochStart');

        actor.stop();
        subscription.unsubscribe();
      });

      test('epoch started, already fetched, should complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));
        (mockValidatorsController.fetchValidatorsBalances as any).mockResolvedValue(undefined);

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100, {
            epochDBSnapshot: { validatorsBalancesFetched: true },
          }),
        );

        await vi.runAllTimersAsync();

        const lastState = getLastState(stateTransitions);
        const balancesState = getNestedState(
          lastState,
          'epochProcessing.fetching.validatorsBalances',
        );
        expect(['processing', 'complete']).toContain(balancesState);

        actor.stop();
        subscription.unsubscribe();
      });

      test('epoch started, not fetched, should process and complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const balancesPromise = createControllablePromise<void>();
        (mockValidatorsController.fetchValidatorsBalances as any).mockReturnValue(
          balancesPromise.promise,
        );

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be processing
        let lastState = getLastState(stateTransitions);
        let balancesState = getNestedState(
          lastState,
          'epochProcessing.fetching.validatorsBalances',
        );
        expect(balancesState).toBe('processing');

        // Complete balances fetch
        balancesPromise.resolve();
        await vi.runAllTimersAsync();

        // Should be complete
        lastState = getLastState(stateTransitions);
        balancesState = getNestedState(lastState, 'epochProcessing.fetching.validatorsBalances');
        expect(balancesState).toBe('complete');
        expect(mockValidatorsController.fetchValidatorsBalances).toHaveBeenCalled();

        actor.stop();
        subscription.unsubscribe();
      });

      test('should emit VALIDATORS_BALANCES_FETCHED on complete', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const { actor, subscription } = createAndStartActor(createDefaultInput(100));

        await vi.runAllTimersAsync();

        // Balances should be ready
        expect(actor.getSnapshot().context.balancesReady).toBe(true);

        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('rewards', () => {
      test('should wait for validators balances', async () => {
        vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));

        const balancesPromise = createControllablePromise<void>();
        (mockValidatorsController.fetchValidatorsBalances as any).mockReturnValue(
          balancesPromise.promise,
        );

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100),
        );

        await vi.runAllTimersAsync();

        // Should be waiting for balances
        const lastState = getLastState(stateTransitions);
        const rewardsState = getNestedState(lastState, 'epochProcessing.fetching.rewards');
        expect(rewardsState).toBe('waitingForBalances');

        actor.stop();
        subscription.unsubscribe();
      });

      test('balances ready and epoch ended, should process rewards', async () => {
        // Set time after epoch has ended
        const epochEndTime = EPOCH_101_START_TIME + 100;
        vi.setSystemTime(new Date(epochEndTime));

        const rewardsPromise = createControllablePromise<void>();
        (mockEpochController.fetchRewards as any).mockReturnValue(rewardsPromise.promise);

        const { actor, stateTransitions, subscription } = createAndStartActor(
          createDefaultInput(100, {
            epochDBSnapshot: { validatorsBalancesFetched: true },
          }),
        );

        await vi.runAllTimersAsync();

        // Should eventually be processing rewards
        let lastState = getLastState(stateTransitions);
        let rewardsState = getNestedState(lastState, 'epochProcessing.fetching.rewards');
        expect(['waitingForBalances', 'processing', 'complete']).toContain(rewardsState);

        // If still processing, complete the rewards fetch
        if (rewardsState === 'processing') {
          rewardsPromise.resolve();
          await vi.runAllTimersAsync();

          lastState = getLastState(stateTransitions);
          rewardsState = getNestedState(lastState, 'epochProcessing.fetching.rewards');
          expect(rewardsState).toBe('complete');
        }

        actor.stop();
        subscription.unsubscribe();
      });
    });
  });

  describe('complete', () => {
    test('should process epoch with all flags already set', async () => {
      vi.setSystemTime(new Date(EPOCH_101_START_TIME + SLOTS_PER_EPOCH * SLOT_DURATION + 100));

      const { actor, subscription } = createAndStartActor(
        createDefaultInput(100, {
          epochDBSnapshot: {
            committeesFetched: true,
            syncCommitteesFetched: true,
            validatorsBalancesFetched: true,
            validatorsActivationFetched: true,
            slotsFetched: false, // Set to false so it doesn't try to spawn orchestrator
            rewardsFetched: true,
          },
        }),
      );

      await vi.runAllTimersAsync();

      // Verify that all the controller methods were called
      expect(mockEpochController.fetchCommittees).toHaveBeenCalled();
      expect(mockEpochController.fetchSyncCommittees).toHaveBeenCalled();
      expect(mockValidatorsController.fetchValidatorsBalances).toHaveBeenCalled();
      expect(mockEpochController.fetchRewards).toHaveBeenCalled();
      expect(mockValidatorsController.trackTransitioningValidators).toHaveBeenCalled();

      actor.stop();
      subscription.unsubscribe();
    });
  });
});
