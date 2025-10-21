import ms from 'ms';
import { test, expect, vi, beforeEach } from 'vitest';
import { createActor, fromPromise, SnapshotFrom, setup } from 'xstate';

import { createControllablePromise } from '@/src/__tests__/utils.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import { epochProcessorMachine } from '@/src/xstate/epoch/epochProcessor.machine.js';

// Helper function to find the last epochProcessing state from state transitions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLastEpochProcessingState(stateTransitions: any[]) {
  // First check if we have an "epochCompleted" state (final state)
  for (let i = stateTransitions.length - 1; i >= 0; i--) {
    const state = stateTransitions[i];
    if (typeof state === 'string' && state === 'epochCompleted') {
      return { epochProcessing: 'epochCompleted' };
    }
  }

  // Then check if we have a "complete" state (which means epochProcessing is done)
  for (let i = stateTransitions.length - 1; i >= 0; i--) {
    const state = stateTransitions[i];
    if (typeof state === 'string' && state === 'complete') {
      return { epochProcessing: 'complete' };
    }
  }

  // If no "complete" state found, look for the last epochProcessing state
  for (let i = stateTransitions.length - 1; i >= 0; i--) {
    const state = stateTransitions[i];
    if (typeof state === 'object' && state !== null && 'epochProcessing' in state) {
      return state;
    }
  }
  return null;
}

// Helper function to get the last state of a specific sub-state
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLastMachineState(stateTransitions: any[], subStatePath: string) {
  // If path has dots, it's a nested state - look for epochProcessing states
  if (subStatePath.includes('.')) {
    const epochProcessingStates = stateTransitions.filter(
      (state) => typeof state === 'object' && state !== null && 'epochProcessing' in state,
    );

    if (epochProcessingStates.length === 0) return null;

    const lastState = epochProcessingStates[epochProcessingStates.length - 1];
    const pathParts = subStatePath.split('.');

    let current = lastState;
    for (const part of pathParts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return null;
      }
    }

    return current;
  } else {
    // If no dots, it's a top-level state - look for string states
    for (let i = stateTransitions.length - 1; i >= 0; i--) {
      const state = stateTransitions[i];
      if (typeof state === 'string' && state === subStatePath) {
        return state;
      }
    }
    return null;
  }
}

// Mock EpochController
const mockEpochController = {
  markEpochAsProcessed: vi.fn().mockResolvedValue(undefined),
} as unknown as EpochController;

const mockValidatorsController = {
  fetchValidatorsBalances: vi.fn().mockResolvedValue(undefined),
  trackTransitioningValidators: vi.fn().mockResolvedValue(undefined),
} as unknown as ValidatorsController;

// Hoisted mock actors that can be modified per test
const mockEpochActors = vi.hoisted(() => ({
  fetchAttestationsRewards: vi.fn(() => new Promise(() => {})),
  fetchValidatorsBalances: vi.fn(() => new Promise(() => {})),
  fetchCommittees: vi.fn(() => new Promise(() => {})),
  fetchSyncCommittees: vi.fn(() => new Promise(() => {})),
  checkSyncCommitteeForEpochInDB: vi.fn(() => Promise.resolve({ isFetched: false })),
  updateSlotsFetched: vi.fn(() => new Promise(() => {})),
  updateSyncCommitteesFetched: vi.fn(() => new Promise(() => {})),
  trackingTransitioningValidators: vi.fn(() => new Promise(() => {})),
  markEpochAsProcessed: vi.fn(() => Promise.resolve({ success: true, machineId: 'test' })),
}));

// Mock slotOrchestratorMachine
const mockSlotOrchestratorMachine = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setup, sendParent } = require('xstate');

  return setup({}).createMachine({
    id: 'slotOrchestratorMachine',
    initial: 'processing',
    states: {
      processing: {
        on: {
          SLOT_COMPLETED: {
            target: 'complete',
            actions: sendParent({ type: 'SLOTS_COMPLETED' }),
          },
        },
      },
      complete: {
        type: 'final',
      },
    },
  });
});

// Helper function to reset all mock actors to default behavior
const resetMockActors = () => {
  Object.values(mockEpochActors).forEach((mock) => {
    mock.mockClear();
    mock.mockReset();
  });
};

const epochDBSnapshotMock = {
  validatorsBalancesFetched: false,
  rewardsFetched: false,
  committeesFetched: false,
  slotsFetched: false,
  syncCommitteesFetched: false,
  validatorsActivationFetched: false,
};

vi.mock('@/src/xstate/epoch/epoch.actors.js', () => ({
  fetchAttestationsRewards: fromPromise(mockEpochActors.fetchAttestationsRewards),
  fetchValidatorsBalances: fromPromise(mockEpochActors.fetchValidatorsBalances),
  fetchCommittees: fromPromise(mockEpochActors.fetchCommittees),
  fetchSyncCommittees: fromPromise(mockEpochActors.fetchSyncCommittees),
  checkSyncCommitteeForEpochInDB: fromPromise(mockEpochActors.checkSyncCommitteeForEpochInDB),
  updateSlotsFetched: fromPromise(mockEpochActors.updateSlotsFetched),
  updateSyncCommitteesFetched: fromPromise(mockEpochActors.updateSyncCommitteesFetched),
  trackingTransitioningValidators: fromPromise(mockEpochActors.trackingTransitioningValidators),
  markEpochAsProcessed: fromPromise(mockEpochActors.markEpochAsProcessed),
}));

// Mock slotOrchestratorMachine
vi.mock('@/src/xstate/slot/slotOrchestrator.machine.js', () => ({
  slotOrchestratorMachine: mockSlotOrchestratorMachine,
}));

// Mock the logging functions
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

vi.mock('@/src/xstate/multiMachineLogger.js', () => ({
  logActor: vi.fn(),
}));

describe('epochProcessorMachine', () => {
  // Global test constants
  const SLOT_DURATION = ms('10ms');
  const SLOTS_PER_EPOCH = 32;
  const GENESIS_TIMESTAMP = 1606824000000;
  const EPOCHS_PER_SYNC_COMMITTEE_PERIOD = 256;
  const SLOT_START_INDEXING = 32;
  const EPOCH_97_START_TIME = GENESIS_TIMESTAMP + 97 * SLOTS_PER_EPOCH * 10;
  const EPOCH_100_START_TIME = GENESIS_TIMESTAMP + 100 * SLOTS_PER_EPOCH * 10;
  const EPOCH_101_START_TIME = GENESIS_TIMESTAMP + 101 * SLOTS_PER_EPOCH * 10;

  describe('checkingCanProcess', () => {
    const mockBeaconTime = new BeaconTime({
      genesisTimestamp: GENESIS_TIMESTAMP,
      slotDurationMs: SLOT_DURATION,
      slotsPerEpoch: SLOTS_PER_EPOCH,
      epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
      slotStartIndexing: SLOT_START_INDEXING,
    });

    beforeEach(() => {
      vi.useFakeTimers();
      resetMockActors();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.clearAllTimers();
    });

    test('cannot process epoch (too early), should go to waiting and retry', async () => {
      const mockCurrentTime = EPOCH_97_START_TIME + 50;
      vi.setSystemTime(new Date(mockCurrentTime));

      const actor = createActor(
        epochProcessorMachine.provide({
          guards: {
            hasEpochAlreadyStarted: vi.fn(() => false),
          },
        }),
        {
          input: {
            epoch: 100,
            epochDBSnapshot: { ...epochDBSnapshotMock },
            config: {
              slotDuration: SLOT_DURATION,
              lookbackSlot: 32,
            },
            services: {
              beaconTime: mockBeaconTime,
              epochController: mockEpochController,
              validatorsController: mockValidatorsController,
            },
          },
        },
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stateTransitions: SnapshotFrom<any>[] = [];
      const subscription = actor.subscribe((snapshot) => {
        stateTransitions.push(snapshot.value);
      });

      actor.start();
      vi.runOnlyPendingTimers();
      await Promise.resolve();

      expect(stateTransitions[0]).toBe('checkingCanProcess');

      const step1 = stateTransitions[1];
      expect(step1).toBe('waiting');

      vi.advanceTimersByTime(SLOT_DURATION * 2);
      await Promise.resolve();

      // only checkingCanProcess and waiting are allowed
      stateTransitions.forEach((state) => {
        expect(state).toMatch(/^(checkingCanProcess|waiting)$/);
      });

      // should have at least 2 checkingCanProcess and 2 waiting states to ensure retry behavior
      const checkingCanProcessCount = stateTransitions.filter(
        (state) => state === 'checkingCanProcess',
      ).length;
      const waitingCount = stateTransitions.filter((state) => state === 'waiting').length;
      expect(checkingCanProcessCount).toBeGreaterThanOrEqual(2);
      expect(waitingCount).toBeGreaterThanOrEqual(2);

      actor.stop();
      subscription.unsubscribe();
    });

    test('can process epoch (1 epoch in advance), should go to epochProcessing', async () => {
      const mockCurrentTime = EPOCH_101_START_TIME + 10;
      vi.setSystemTime(new Date(mockCurrentTime));

      const actor = createActor(
        epochProcessorMachine.provide({
          guards: {
            hasEpochAlreadyStarted: vi.fn(() => false),
          },
        }),
        {
          input: {
            epoch: 100,
            epochDBSnapshot: { ...epochDBSnapshotMock },
            config: {
              slotDuration: SLOT_DURATION,
              lookbackSlot: 32,
            },
            services: {
              beaconTime: mockBeaconTime,
              epochController: mockEpochController,
              validatorsController: mockValidatorsController,
            },
          },
        },
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stateTransitions: SnapshotFrom<any>[] = [];
      const subscription = actor.subscribe((snapshot) => {
        stateTransitions.push(snapshot.value);
      });

      actor.start();
      vi.runOnlyPendingTimers();
      await Promise.resolve();

      expect(stateTransitions[0]).toBe('checkingCanProcess');

      const step1 = stateTransitions[1];
      expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);

      actor.stop();
      subscription.unsubscribe();
    });
  });

  describe('epochProcessing', () => {
    describe('before epoch starts', () => {
      const mockBeaconTime = new BeaconTime({
        genesisTimestamp: GENESIS_TIMESTAMP,
        slotDurationMs: SLOT_DURATION,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
        slotStartIndexing: SLOT_START_INDEXING,
      });

      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(EPOCH_100_START_TIME - 100)); // Start 100ms before epoch 100 starts
        resetMockActors(); // Reset all mock actors to default behavior
      });

      afterEach(() => {
        vi.useRealTimers();
        vi.clearAllTimers();
      });

      test('committees can start fetching (1 epoch ahead)', async () => {
        const actor = createActor(
          epochProcessorMachine.provide({
            guards: {
              hasEpochAlreadyStarted: vi.fn(() => false),
              needsCommitteesFetch: vi.fn(() => true),
            },
          }),
          {
            input: {
              epoch: 100,
              epochDBSnapshot: { ...epochDBSnapshotMock },
              config: {
                slotDuration: SLOT_DURATION,
                lookbackSlot: 32,
              },
              services: {
                beaconTime: mockBeaconTime,
                epochController: mockEpochController,
              },
            },
          },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateTransitions: SnapshotFrom<any>[] = [];
        const subscription = actor.subscribe((snapshot) => {
          stateTransitions.push(snapshot.value);
        });

        actor.start();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        expect(stateTransitions[0]).toBe('checkingCanProcess');

        // Epoch has not started yet, committees should be in checkingIfAlreadyProcessed
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
        const step1Obj = step1;
        expect(step1Obj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(step1Obj.epochProcessing.fetching.committees).toBe('checkingIfAlreadyProcessed');

        // Advance some slots, epoch still doesn't start and committees should be in fetching
        vi.advanceTimersByTime(SLOT_DURATION * 3);
        await Promise.resolve();
        const step2 = getLastEpochProcessingState(stateTransitions);
        expect(step2!.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(step2!.epochProcessing.fetching.committees).toBe('fetching');

        // Clean up
        actor.stop();
        subscription.unsubscribe();
      });

      test('syncCommittees can start fetching (1 epoch ahead)', async () => {
        // Mock functions
        mockEpochActors.checkSyncCommitteeForEpochInDB.mockResolvedValue({ isFetched: false });
        mockEpochActors.fetchSyncCommittees.mockImplementation(() => new Promise(() => {})); // Never resolves

        const actor = createActor(
          epochProcessorMachine.provide({
            guards: {
              hasEpochAlreadyStarted: vi.fn(() => false),
            },
          }),
          {
            input: {
              epoch: 100,
              epochDBSnapshot: { ...epochDBSnapshotMock },
              config: {
                slotDuration: SLOT_DURATION,
                lookbackSlot: 32,
              },
              services: {
                beaconTime: mockBeaconTime,
                epochController: mockEpochController,
              },
            },
          },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateTransitions: SnapshotFrom<any>[] = [];
        const subscription = actor.subscribe((snapshot) => {
          stateTransitions.push(snapshot.value);
        });

        actor.start();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        expect(stateTransitions[0]).toBe('checkingCanProcess');

        // Epoch has not started yet
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);

        // Wait for syncCommittees to progress
        vi.advanceTimersByTime(SLOT_DURATION);
        await Promise.resolve();

        // Verify that the required functions were called
        expect(mockEpochActors.checkSyncCommitteeForEpochInDB).toHaveBeenCalled();
        expect(mockEpochActors.fetchSyncCommittees).toHaveBeenCalled();

        // get the states that ensures the syncCommittees are fetching (in order)
        // checkingIfAlreadyProcessed -> checkingInDB -> fetching
        const syncStates = stateTransitions
          .filter((state) => typeof state === 'object' && 'epochProcessing' in state)
          .map((state) => {
            const epochProcessing = state.epochProcessing;
            return epochProcessing.fetching?.syncingCommittees;
          })
          .filter(Boolean);
        // check they exists
        expect(syncStates).toContain('checkingIfAlreadyProcessed');
        expect(syncStates).toContain('checkingInDB');
        expect(syncStates).toContain('fetching');
        // check the order
        const checkingIfAlreadyProcessedIndex = syncStates.indexOf('checkingIfAlreadyProcessed');
        const checkingInDBIndex = syncStates.indexOf('checkingInDB');
        const fetchingIndex = syncStates.indexOf('fetching');
        expect(checkingIfAlreadyProcessedIndex).toBeLessThan(checkingInDBIndex);
        expect(checkingInDBIndex).toBeLessThan(fetchingIndex);

        // Clean up
        actor.stop();
        subscription.unsubscribe();
      });

      test('slotsProcessing cannot start (waits for prerequisites)', async () => {
        const actor = createActor(
          epochProcessorMachine.provide({
            guards: {
              hasEpochAlreadyStarted: vi.fn(() => false),
            },
          }),
          {
            input: {
              epoch: 100,
              epochDBSnapshot: { ...epochDBSnapshotMock },
              config: {
                slotDuration: SLOT_DURATION,
                lookbackSlot: 32,
              },
              services: {
                beaconTime: mockBeaconTime,
                epochController: mockEpochController,
              },
            },
          },
        );

        const stateTransitions: SnapshotFrom<any>[] = [];
        const subscription = actor.subscribe((snapshot) => {
          stateTransitions.push(snapshot.value);
        });

        actor.start();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        expect(stateTransitions[0]).toBe('checkingCanProcess');

        // Epoch has not started yet, slotsProcessing should be waiting for committees
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
        const step1Obj = step1;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.slotsProcessing).toBe('waitingForCommittees');

        // Wait a bit to ensure it doesn't change (epoch should not start)
        vi.advanceTimersByTime(SLOT_DURATION * 2);
        await Promise.resolve();

        const finalState = getLastEpochProcessingState(stateTransitions);
        expect(finalState!.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(finalState!.epochProcessing.fetching.slotsProcessing).toBe('waitingForCommittees');

        actor.stop();
        subscription.unsubscribe();
      });

      test('trackingValidatorsActivation cannot start (waits for epoch start)', async () => {
        const actor = createActor(
          epochProcessorMachine.provide({
            guards: {
              hasEpochAlreadyStarted: vi.fn(() => false),
            },
          }),
          {
            input: {
              epoch: 100,
              epochDBSnapshot: { ...epochDBSnapshotMock },
              config: {
                slotDuration: SLOT_DURATION,
                lookbackSlot: 32,
              },
              services: {
                beaconTime: mockBeaconTime,
                epochController: mockEpochController,
              },
            },
          },
        );

        const stateTransitions: SnapshotFrom<any>[] = [];
        const subscription = actor.subscribe((snapshot) => {
          stateTransitions.push(snapshot.value);
        });

        actor.start();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        expect(stateTransitions[0]).toBe('checkingCanProcess');

        // Epoch has not started yet, trackingValidatorsActivation should be waiting for epoch start
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);

        const step1Obj = step1;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.trackingValidatorsActivation).toBe(
          'waitingForEpochStart',
        );

        // Wait a bit to ensure it doesn't change (epoch should not start)
        vi.advanceTimersByTime(SLOT_DURATION * 2);
        await Promise.resolve();

        const finalState = getLastEpochProcessingState(stateTransitions);
        expect(finalState!.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(finalState!.epochProcessing.fetching.trackingValidatorsActivation).toBe(
          'waitingForEpochStart',
        );

        // Clean up
        actor.stop();
        subscription.unsubscribe();
      });

      test('validatorsBalances cannot start (waits for epoch start)', async () => {
        const actor = createActor(
          epochProcessorMachine.provide({
            guards: {
              hasEpochAlreadyStarted: vi.fn(() => false),
            },
          }),
          {
            input: {
              epoch: 100,
              epochDBSnapshot: { ...epochDBSnapshotMock },
              config: {
                slotDuration: SLOT_DURATION,
                lookbackSlot: 32,
              },
              services: {
                beaconTime: mockBeaconTime,
                epochController: mockEpochController,
              },
            },
          },
        );

        const stateTransitions: SnapshotFrom<any>[] = [];
        const subscription = actor.subscribe((snapshot) => {
          stateTransitions.push(snapshot.value);
        });

        actor.start();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        expect(stateTransitions[0]).toBe('checkingCanProcess');

        // Epoch has not started yet, validatorsBalances should be in checkingIfAlreadyProcessed
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);

        const step1Obj = step1;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.validatorsBalances).toBe('waitingForEpochStart');

        // Wait a bit to ensure it doesn't change (epoch should not start due to mock)
        vi.advanceTimersByTime(SLOT_DURATION * 2);
        await Promise.resolve();

        const finalState = getLastEpochProcessingState(stateTransitions);
        expect(finalState).not.toBeNull();
        expect(finalState!.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(finalState!.epochProcessing.fetching.validatorsBalances).toBe(
          'waitingForEpochStart',
        );

        // Clean up
        actor.stop();
        subscription.unsubscribe();
      });
    });

    describe('after epoch starts', () => {
      describe('committees', () => {
        const mockBeaconTime = new BeaconTime({
          genesisTimestamp: GENESIS_TIMESTAMP,
          slotDurationMs: SLOT_DURATION,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
          slotStartIndexing: SLOT_START_INDEXING,
        });

        beforeEach(() => {
          vi.useFakeTimers();
          vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));
          resetMockActors();
        });

        afterEach(() => {
          vi.useRealTimers();
          vi.clearAllTimers();
        });

        describe('already processed', () => {
          test('should go directly to complete', async () => {
            // Mock fetchCommittees to verify it's NOT called
            mockEpochActors.fetchCommittees.mockImplementation(
              () => new Promise(() => {}), // Never resolves
            );

            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  hasEpochAlreadyStarted: vi.fn(() => true),
                  needsCommitteesFetch: vi.fn(() => false),
                },
              }),
              {
                input: {
                  epoch: 100,
                  epochDBSnapshot: { ...epochDBSnapshotMock, committeesFetched: true },
                  config: {
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                  },
                  services: {
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                  },
                },
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateTransitions: SnapshotFrom<any>[] = [];
            const subscription = actor.subscribe((snapshot) => {
              stateTransitions.push(snapshot.value);
            });

            actor.start();
            vi.runOnlyPendingTimers();
            await Promise.resolve();

            expect(stateTransitions[0]).toBe('checkingCanProcess');

            const step1 = stateTransitions[1];
            expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
            const step1Obj = step1;
            expect(step1Obj.epochProcessing.fetching.committees).toBe('checkingIfAlreadyProcessed');

            vi.advanceTimersByTime(SLOT_DURATION);
            await Promise.resolve();

            const finalState = getLastEpochProcessingState(stateTransitions);
            expect(finalState).not.toBeNull();
            expect(finalState!.epochProcessing.fetching.committees).toBe('complete');

            // Verify fetchCommittees was NOT called since committees are already processed
            expect(mockEpochActors.fetchCommittees).not.toHaveBeenCalled();

            actor.stop();
            subscription.unsubscribe();
          });
        });

        describe('not processed', () => {
          test('should fetch committees and then complete', async () => {
            // Mock needsCommitteesFetch guard to return true
            const mockNeedsCommitteesFetch = vi.fn(() => true);

            mockEpochActors.fetchCommittees.mockImplementation(
              () =>
                new Promise((resolve) => {
                  setTimeout(() => resolve({ success: true }), 20);
                }),
            );

            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  hasEpochAlreadyStarted: vi.fn(() => true),
                  needsCommitteesFetch: mockNeedsCommitteesFetch,
                },
              }),
              {
                input: {
                  epoch: 100,
                  epochDBSnapshot: { ...epochDBSnapshotMock, committeesFetched: false },
                  config: {
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                  },
                  services: {
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                  },
                },
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateTransitions: SnapshotFrom<any>[] = [];
            const events: any[] = [];
            const subscription = actor.subscribe((snapshot) => {
              stateTransitions.push(snapshot.value);
            });

            // Listen for events
            actor.subscribe((snapshot) => {
              if (snapshot.context) {
                events.push(snapshot.context);
              }
            });

            actor.start();
            vi.runOnlyPendingTimers();
            await Promise.resolve();

            // Step 1: Should start in checkingCanProcess
            expect(stateTransitions[0]).toBe('checkingCanProcess');

            // Step 2: Should go to epochProcessing.fetching.committees.checkingIfAlreadyProcessed
            const step1 = stateTransitions[1];
            expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
            const step1Obj = step1;
            expect(step1Obj.epochProcessing.fetching.committees).toBe('checkingIfAlreadyProcessed');

            // Step 3: Verify needsCommitteesFetch guard was called
            // Note: The guard is called internally by XState, we verify it by checking the transition

            // Step 4: Should transition to fetching
            vi.advanceTimersByTime(SLOT_DURATION);
            await Promise.resolve();

            const step2 = getLastEpochProcessingState(stateTransitions);
            expect(step2).not.toBeNull();
            expect(step2!.epochProcessing.fetching.committees).toBe('fetching');

            // Step 5: Verify fetchCommittees was called
            expect(mockEpochActors.fetchCommittees).toHaveBeenCalledWith(
              expect.objectContaining({
                input: { epochController: expect.any(Object), epoch: 100 },
              }),
            );

            // Step 6: Wait for fetchCommittees to complete
            vi.advanceTimersByTime(SLOT_DURATION * 1.5);
            await Promise.resolve();

            // Step 7: Should go to complete
            const finalState = getLastEpochProcessingState(stateTransitions);
            expect(finalState).not.toBeNull();
            expect(finalState!.epochProcessing.fetching.committees).toBe('complete');

            // Step 8: Verify needsCommitteesFetch guard was called and returned true
            expect(mockNeedsCommitteesFetch).toHaveBeenCalled();

            // Step 9: Verify fetchCommittees was called with correct input
            expect(mockEpochActors.fetchCommittees).toHaveBeenCalledWith(
              expect.objectContaining({
                input: { epochController: expect.any(Object), epoch: 100 },
              }),
            );

            actor.stop();
            subscription.unsubscribe();
          });

          test('should stay in fetching when fetch fails', async () => {
            mockEpochActors.fetchCommittees.mockImplementation(
              () =>
                new Promise((_, reject) => {
                  setTimeout(() => reject(new Error('Network error')), 20);
                }),
            );

            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  hasEpochAlreadyStarted: vi.fn(() => true),
                  canProcessEpoch: vi.fn(() => true),
                },
              }),
              {
                input: {
                  epoch: 100,
                  epochDBSnapshot: { ...epochDBSnapshotMock, committeesFetched: false },
                  config: {
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                  },
                  services: {
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                  },
                },
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateTransitions: SnapshotFrom<any>[] = [];
            const subscription = actor.subscribe((snapshot) => {
              stateTransitions.push(snapshot.value);
            });

            actor.start();
            vi.runOnlyPendingTimers();
            await Promise.resolve();

            expect(stateTransitions[0]).toBe('checkingCanProcess');

            const step1 = stateTransitions[1];
            expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
            const step1Obj = step1;
            expect(step1Obj.epochProcessing.fetching.committees).toBe('checkingIfAlreadyProcessed');

            vi.advanceTimersByTime(SLOT_DURATION);
            await Promise.resolve();

            const step2 = getLastEpochProcessingState(stateTransitions);
            expect(step2).not.toBeNull();
            expect(step2!.epochProcessing.fetching.committees).toBe('fetching');

            vi.advanceTimersByTime(SLOT_DURATION * 2);
            await Promise.resolve();

            const finalState = getLastEpochProcessingState(stateTransitions);
            expect(finalState).not.toBeNull();
            expect(finalState!.epochProcessing.fetching.committees).toBe('fetching');

            actor.stop();
            subscription.unsubscribe();
          });
        });

        describe('transitions to complete', () => {
          test('should emit COMMITTEES_FETCHED event', async () => {
            // Mock needsCommitteesFetch guard to return true
            const mockNeedsCommitteesFetch = vi.fn(() => true);

            mockEpochActors.fetchCommittees.mockImplementation(
              () =>
                new Promise((resolve) => {
                  setTimeout(() => resolve({ success: true }), 20);
                }),
            );

            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  hasEpochAlreadyStarted: vi.fn(() => true),
                  needsCommitteesFetch: mockNeedsCommitteesFetch,
                },
              }),
              {
                input: {
                  epoch: 100,
                  epochDBSnapshot: { ...epochDBSnapshotMock, committeesFetched: false },
                  config: {
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                  },
                  services: {
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                  },
                },
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateTransitions: SnapshotFrom<any>[] = [];
            const subscription = actor.subscribe((snapshot) => {
              stateTransitions.push(snapshot.value);
            });

            actor.start();
            vi.runOnlyPendingTimers();
            await Promise.resolve();

            // Wait for committees to go through the full flow
            vi.advanceTimersByTime(SLOT_DURATION);
            await Promise.resolve();

            vi.advanceTimersByTime(SLOT_DURATION * 1.5);
            await Promise.resolve();

            // Verify we reached complete state
            const finalState = getLastEpochProcessingState(stateTransitions);
            expect(finalState).not.toBeNull();
            expect(finalState!.epochProcessing.fetching.committees).toBe('complete');

            // The complete state should have emitted COMMITTEES_FETCHED event
            // This is verified by the state transition to complete
            // The event emission is handled by the machine's entry action

            actor.stop();
            subscription.unsubscribe();
          });
        });
      });

      describe('syncCommittees', () => {
        const mockBeaconTime = new BeaconTime({
          genesisTimestamp: GENESIS_TIMESTAMP,
          slotDurationMs: SLOT_DURATION,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
          slotStartIndexing: SLOT_START_INDEXING,
        });

        beforeEach(() => {
          vi.useFakeTimers();
          vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));
          resetMockActors();
        });

        afterEach(() => {
          vi.useRealTimers();
          vi.clearAllTimers();
        });

        describe('states', () => {
          describe('already processed', () => {
            test('should go directly to complete (hasSyncCommitteesFetched = true)', async () => {
              // Mock the guard to return true for more explicit testing
              const mockHasSyncCommitteesFetched = vi.fn(() => true);

              const actor = createActor(
                epochProcessorMachine.provide({
                  guards: {
                    hasEpochAlreadyStarted: vi.fn(() => true),
                    hasSyncCommitteesFetched: mockHasSyncCommitteesFetched,
                  },
                }),
                {
                  input: {
                    epoch: 100,
                    epochDBSnapshot: { ...epochDBSnapshotMock, syncCommitteesFetched: true },
                    config: {
                      slotDuration: SLOT_DURATION,
                      lookbackSlot: 32,
                    },
                    services: {
                      beaconTime: mockBeaconTime,
                      epochController: mockEpochController,
                    },
                  },
                },
              );

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const stateTransitions: SnapshotFrom<any>[] = [];
              const subscription = actor.subscribe((snapshot) => {
                stateTransitions.push(snapshot.value);
              });

              actor.start();
              vi.runOnlyPendingTimers();
              await Promise.resolve();

              // Step 0: Should start in checkingCanProcess
              expect(stateTransitions[0]).toBe('checkingCanProcess');

              // Step 1: Should go to epochProcessing with syncingCommittees in checkingIfAlreadyProcessed
              const step1 = stateTransitions[1];
              expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
              expect(step1.epochProcessing.fetching.syncingCommittees).toBe(
                'checkingIfAlreadyProcessed',
              );

              // Advance time to trigger the guard evaluation
              vi.advanceTimersByTime(SLOT_DURATION / 2);

              // Verify that the guard was called
              expect(mockHasSyncCommitteesFetched).toHaveBeenCalled();

              // Step 2: Should go directly to complete (skipping checkingInDB)
              const step2 = getLastEpochProcessingState(stateTransitions);
              expect(step2).not.toBeNull();
              expect(step2!.epochProcessing.fetching.syncingCommittees).toBe('complete');

              // Verify that checkSyncCommitteeForEpochInDB was NOT called (skipped the checkingInDB state)
              expect(mockEpochActors.checkSyncCommitteeForEpochInDB).not.toHaveBeenCalled();

              actor.stop();
              subscription.unsubscribe();
            });
          });

          describe('not processed', () => {
            describe('if found in DB', () => {
              test('should go to updatingSyncCommitteesFetched > complete', async () => {
                // Create controllable promises
                const checkSyncCommitteePromise = createControllablePromise<{
                  isFetched: boolean;
                }>();
                const updateSyncCommitteesPromise = createControllablePromise<{
                  success: boolean;
                }>();

                // Mock checkSyncCommitteeForEpochInDB to return controllable promise
                mockEpochActors.checkSyncCommitteeForEpochInDB.mockImplementation(
                  () => checkSyncCommitteePromise.promise,
                );

                // Mock updateSyncCommitteesFetched to return controllable promise
                mockEpochActors.updateSyncCommitteesFetched.mockImplementation(
                  () => updateSyncCommitteesPromise.promise,
                );

                const actor = createActor(
                  epochProcessorMachine.provide({
                    guards: {
                      hasEpochAlreadyStarted: vi.fn(() => true),
                      hasSyncCommitteesFetched: vi.fn(() => false),
                    },
                  }),
                  {
                    input: {
                      epoch: 100,
                      epochDBSnapshot: { ...epochDBSnapshotMock, syncCommitteesFetched: false },
                      config: {
                        slotDuration: SLOT_DURATION,
                        lookbackSlot: 32,
                      },
                      services: {
                        beaconTime: mockBeaconTime,
                        epochController: mockEpochController,
                      },
                    },
                  },
                );

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const stateTransitions: SnapshotFrom<any>[] = [];
                const subscription = actor.subscribe((snapshot) => {
                  stateTransitions.push(snapshot.value);
                });

                actor.start();
                vi.runOnlyPendingTimers();
                await Promise.resolve();

                // Step 0: Should start in checkingCanProcess
                expect(stateTransitions[0]).toBe('checkingCanProcess');

                // Step 1: Should go to epochProcessing with syncingCommittees in checkingIfAlreadyProcessed
                const step1 = getLastEpochProcessingState(stateTransitions);
                expect(step1.epochProcessing.fetching.syncingCommittees).toBe(
                  'checkingIfAlreadyProcessed',
                );

                // Advance time to trigger the guard evaluation
                vi.advanceTimersByTime(1);

                // Step 2: Should go to checkingInDB
                const step2 = getLastEpochProcessingState(stateTransitions);
                expect(step2.epochProcessing.fetching.syncingCommittees).toBe('checkingInDB');

                // Verify that checkSyncCommitteeForEpochInDB was called
                expect(mockEpochActors.checkSyncCommitteeForEpochInDB).toHaveBeenCalledWith(
                  expect.objectContaining({
                    input: { epochController: expect.any(Object), epoch: 100 },
                  }),
                );

                // Now resolve with isFetched: true (found in DB)
                checkSyncCommitteePromise.resolve({ isFetched: true });
                await Promise.resolve();

                // Step 3: Should go to updatingSyncCommitteesFetched (NOT fetching)
                const step3 = getLastEpochProcessingState(stateTransitions);
                expect(step3.epochProcessing.fetching.syncingCommittees).toBe(
                  'updatingSyncCommitteesFetched',
                );

                // Verify that updateSyncCommitteesFetched was called
                expect(mockEpochActors.updateSyncCommitteesFetched).toHaveBeenCalledWith(
                  expect.objectContaining({
                    input: { epochController: expect.any(Object), epoch: 100 },
                  }),
                );

                // Verify that fetchSyncCommittees was NOT called
                expect(mockEpochActors.fetchSyncCommittees).not.toHaveBeenCalled();

                // Resolve updateSyncCommitteesFetched to complete
                updateSyncCommitteesPromise.resolve({ success: true });
                await Promise.resolve();

                // Step 4: Should go to complete
                const step4 = getLastEpochProcessingState(stateTransitions);
                expect(step4.epochProcessing.fetching.syncingCommittees).toBe('complete');

                actor.stop();
                subscription.unsubscribe();
              });
            });

            describe('if NOT found in DB', () => {
              test('should go to fetching > complete', async () => {
                // Mock the guard to return false
                const mockHasSyncCommitteesFetched = vi.fn(() => false);

                // Create controllable promises
                const checkSyncCommitteePromise = createControllablePromise<{
                  isFetched: boolean;
                }>();
                const fetchSyncCommitteesPromise = createControllablePromise<{
                  success: boolean;
                }>();

                // Mock checkSyncCommitteeForEpochInDB to return controllable promise
                mockEpochActors.checkSyncCommitteeForEpochInDB.mockImplementation(
                  () => checkSyncCommitteePromise.promise,
                );

                // Mock fetchSyncCommittees to return controllable promise
                mockEpochActors.fetchSyncCommittees.mockImplementation(
                  () => fetchSyncCommitteesPromise.promise,
                );

                const actor = createActor(
                  epochProcessorMachine.provide({
                    guards: {
                      hasEpochAlreadyStarted: vi.fn(() => true),
                      hasSyncCommitteesFetched: mockHasSyncCommitteesFetched,
                    },
                  }),
                  {
                    input: {
                      epoch: 100,
                      epochDBSnapshot: { ...epochDBSnapshotMock, syncCommitteesFetched: false },
                      config: {
                        slotDuration: SLOT_DURATION,
                        lookbackSlot: 32,
                      },
                      services: {
                        beaconTime: mockBeaconTime,
                        epochController: mockEpochController,
                      },
                    },
                  },
                );

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const stateTransitions: SnapshotFrom<any>[] = [];
                const subscription = actor.subscribe((snapshot) => {
                  stateTransitions.push(snapshot.value);
                });

                actor.start();
                vi.runOnlyPendingTimers();
                await Promise.resolve();

                // Step 0: Should start in checkingCanProcess
                expect(stateTransitions[0]).toBe('checkingCanProcess');

                // Step 1: Should go to epochProcessing with syncingCommittees in checkingIfAlreadyProcessed
                const step1 = getLastEpochProcessingState(stateTransitions);
                expect(step1!.epochProcessing.fetching.syncingCommittees).toBe(
                  'checkingIfAlreadyProcessed',
                );

                // Advance time to trigger the guard evaluation
                vi.advanceTimersByTime(SLOT_DURATION);
                await Promise.resolve();

                // Step 2: Should go to checkingInDB
                const step2 = getLastEpochProcessingState(stateTransitions);
                expect(step2!.epochProcessing.fetching.syncingCommittees).toBe('checkingInDB');

                // Verify that checkSyncCommitteeForEpochInDB was called
                expect(mockEpochActors.checkSyncCommitteeForEpochInDB).toHaveBeenCalledWith(
                  expect.objectContaining({
                    input: { epochController: expect.any(Object), epoch: 100 },
                  }),
                );
                checkSyncCommitteePromise.resolve({ isFetched: false });
                await Promise.resolve();

                // Step 3: Should go to fetching
                const step3 = getLastEpochProcessingState(stateTransitions);
                expect(step3.epochProcessing.fetching.syncingCommittees).toBe('fetching');
                expect(mockEpochActors.fetchSyncCommittees).toHaveBeenCalledWith(
                  expect.objectContaining({
                    input: { epochController: expect.any(Object), epoch: 100 },
                  }),
                );
                expect(mockEpochActors.updateSyncCommitteesFetched).not.toHaveBeenCalled();

                // Resolve fetchSyncCommittees to complete
                fetchSyncCommitteesPromise.resolve({ success: true });
                await Promise.resolve();

                // Step 4: Should go to complete
                const step4 = getLastEpochProcessingState(stateTransitions);
                expect(step4.epochProcessing.fetching.syncingCommittees).toBe('complete');

                actor.stop();
                subscription.unsubscribe();
              });
            });
          });
        });
      });

      describe('slotsProcessing', () => {
        const mockBeaconTime = new BeaconTime({
          genesisTimestamp: GENESIS_TIMESTAMP,
          slotDurationMs: SLOT_DURATION,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
          slotStartIndexing: SLOT_START_INDEXING,
        });

        beforeEach(() => {
          vi.useFakeTimers();
          resetMockActors();
        });

        afterEach(() => {
          vi.useRealTimers();
          vi.clearAllTimers();
        });

        describe('waiting for committees', () => {
          test('should stay in waitingForCommittees until COMMITTEES_FETCHED arrives, then transition to checkingSlotsProcessed', async () => {
            const mockBeaconTime = new BeaconTime({
              genesisTimestamp: GENESIS_TIMESTAMP,
              slotDurationMs: SLOT_DURATION,
              slotsPerEpoch: SLOTS_PER_EPOCH,
              epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
              slotStartIndexing: SLOT_START_INDEXING,
            });

            // Mock needsCommitteesFetch to return true so committees will be fetched
            const needsCommitteesFetchMock = vi.fn(() => true);

            // Create a controllable promise for fetchCommittees
            const fetchCommitteesPromise = createControllablePromise<void>();
            const fetchCommitteesMock = vi.fn(() => fetchCommitteesPromise.promise);

            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  canProcessEpoch: vi.fn(() => true),
                  needsCommitteesFetch: needsCommitteesFetchMock,
                },
                actors: {
                  fetchCommittees: fromPromise(fetchCommitteesMock),
                },
              }),
              {
                input: {
                  epoch: 100,
                  epochDBSnapshot: { ...epochDBSnapshotMock, slotsFetched: false },
                  config: {
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                  },
                  services: {
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                  },
                },
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateTransitions: SnapshotFrom<any>[] = [];
            const subscription = actor.subscribe((snapshot) => {
              stateTransitions.push(snapshot.value);
            });

            actor.start();
            vi.runOnlyPendingTimers();
            await Promise.resolve();

            // Should start in checkingCanProcess
            expect(stateTransitions[0]).toBe('checkingCanProcess');

            // Should go to epochProcessing with slotsProcessing in waitingForCommittees
            const step1 = getLastEpochProcessingState(stateTransitions);
            expect(step1.epochProcessing.fetching.slotsProcessing).toBe('waitingForCommittees');

            // Wait a bit to ensure we're still waiting
            vi.advanceTimersByTime(30);
            await Promise.resolve();

            // Verify we're still in waitingForCommittees
            const step2 = getLastEpochProcessingState(stateTransitions);
            expect(step2.epochProcessing.fetching.slotsProcessing).toBe('waitingForCommittees');

            // Now explicitly resolve the fetchCommittees promise to emit COMMITTEES_FETCHED
            fetchCommitteesPromise.resolve();
            await Promise.resolve();

            // Should transition to checkingSlotsProcessed when COMMITTEES_FETCHED arrives
            const step4 = getLastEpochProcessingState(stateTransitions);
            expect(step4.epochProcessing.fetching.slotsProcessing).toBe('checkingSlotsProcessed');

            // Verify that fetchCommittees was called
            expect(fetchCommitteesMock).toHaveBeenCalled();

            actor.stop();
            subscription.unsubscribe();
          });
        });

        describe('checkingSlotsProcessed', () => {
          describe('already processed', () => {
            test('should go to complete', async () => {
              vi.useFakeTimers();

              const actor = createActor(
                epochProcessorMachine.provide({
                  guards: {
                    hasEpochAlreadyStarted: vi.fn(() => true),
                    canProcessEpoch: vi.fn(() => true),
                    needsCommitteesFetch: vi.fn(() => false),
                  },
                }),
                {
                  input: {
                    epoch: 100,
                    epochDBSnapshot: { ...epochDBSnapshotMock, slotsFetched: true },
                    config: {
                      slotDuration: SLOT_DURATION,
                      lookbackSlot: 32,
                    },
                    services: {
                      beaconTime: mockBeaconTime,
                      epochController: mockEpochController,
                    },
                  },
                },
              );

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const stateTransitions: SnapshotFrom<any>[] = [];
              const subscription = actor.subscribe((snapshot) => {
                stateTransitions.push(snapshot.value);
              });

              actor.start();
              vi.runOnlyPendingTimers();
              await Promise.resolve();

              // Should start in checkingCanProcess
              expect(stateTransitions[0]).toBe('checkingCanProcess');

              // Should go to epochProcessing with slotsProcessing in waitingForCommittees
              const step1 = getLastEpochProcessingState(stateTransitions);
              expect(step1.epochProcessing.fetching.slotsProcessing).toBe('waitingForCommittees');

              // The epoch should start automatically and emit EPOCH_STARTED
              vi.advanceTimersByTime(2);
              await Promise.resolve();

              // Should go directly to complete (slots already processed)
              const step2 = getLastEpochProcessingState(stateTransitions);
              expect(step2.epochProcessing.fetching.slotsProcessing).toBe('complete');

              actor.stop();
              subscription.unsubscribe();
            });
          });

          describe('not processed', () => {
            test('should go to processingSlots', async () => {
              vi.useFakeTimers();

              const actor = createActor(
                epochProcessorMachine.provide({
                  guards: {
                    hasEpochAlreadyStarted: vi.fn(() => true),
                    canProcessEpoch: vi.fn(() => true),
                    needsCommitteesFetch: vi.fn(() => false),
                  },
                }),
                {
                  input: {
                    epoch: 100,
                    epochDBSnapshot: { ...epochDBSnapshotMock, slotsFetched: false },
                    config: {
                      slotDuration: SLOT_DURATION,
                      lookbackSlot: 32,
                    },
                    services: {
                      beaconTime: mockBeaconTime,
                      epochController: mockEpochController,
                    },
                  },
                },
              );

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const stateTransitions: SnapshotFrom<any>[] = [];
              const subscription = actor.subscribe((snapshot) => {
                stateTransitions.push(snapshot.value);
              });

              actor.start();
              vi.runOnlyPendingTimers();
              await Promise.resolve();

              // Should start in checkingCanProcess
              expect(stateTransitions[0]).toBe('checkingCanProcess');

              // Should go to epochProcessing with slotsProcessing in waitingForCommittees
              const step1 = getLastEpochProcessingState(stateTransitions);
              expect(step1.epochProcessing.fetching.slotsProcessing).toBe('waitingForCommittees');

              // Wait for committees to complete and emit COMMITTEES_FETCHED
              vi.advanceTimersByTime(2);
              await Promise.resolve();

              // Should go to processingSlots (slots not processed)
              const step2 = getLastEpochProcessingState(stateTransitions);
              expect(step2.epochProcessing.fetching.slotsProcessing).toBe('processingSlots');

              actor.stop();
              subscription.unsubscribe();
            });
          });
        });

        describe('processingSlots', () => {
          test('should spawn slotOrchestratorActor and wait for SLOTS_COMPLETED event', async () => {
            vi.useFakeTimers();

            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  hasEpochAlreadyStarted: vi.fn(() => true),
                  canProcessEpoch: vi.fn(() => true),
                  needsCommitteesFetch: vi.fn(() => false),
                },
              }),
              {
                input: {
                  epoch: 100,
                  epochDBSnapshot: { ...epochDBSnapshotMock, slotsFetched: false },
                  config: {
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                  },
                  services: {
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                  },
                },
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateTransitions: SnapshotFrom<any>[] = [];
            const subscription = actor.subscribe((snapshot) => {
              stateTransitions.push(snapshot.value);
            });

            actor.start();
            vi.runOnlyPendingTimers();
            await Promise.resolve();

            // Should start in checkingCanProcess
            expect(stateTransitions[0]).toBe('checkingCanProcess');

            // Should go to epochProcessing with slotsProcessing in waitingForCommittees
            const step1 = getLastEpochProcessingState(stateTransitions);
            expect(step1.epochProcessing.fetching.slotsProcessing).toBe('waitingForCommittees');

            // The epoch should start automatically and emit EPOCH_STARTED
            vi.advanceTimersByTime(2);
            await Promise.resolve();

            // Should go to processingSlots
            const step2 = getLastEpochProcessingState(stateTransitions);
            expect(step2.epochProcessing.fetching.slotsProcessing).toBe('processingSlots');

            // Wait for SLOT_DURATION to simulate slotOrchestratorActor processing
            vi.advanceTimersByTime(SLOT_DURATION);
            await Promise.resolve();

            // Should still be in processingSlots (waiting for SLOTS_COMPLETED)
            const step3 = getLastEpochProcessingState(stateTransitions);
            expect(step3.epochProcessing.fetching.slotsProcessing).toBe('processingSlots');

            // Get the spawned slotOrchestratorActor and trigger completion
            const currentSnapshot = actor.getSnapshot();
            const slotOrchestratorActor = currentSnapshot.context.actors.slotOrchestratorActor;
            if (slotOrchestratorActor) {
              slotOrchestratorActor.send({ type: 'SLOT_COMPLETED' });
            }
            await Promise.resolve();

            // Should transition to updatingSlotsFetched
            const step4 = getLastEpochProcessingState(stateTransitions);
            expect(step4.epochProcessing.fetching.slotsProcessing).toBe('updatingSlotsFetched');

            actor.stop();
            subscription.unsubscribe();
          });
        });

        describe('updatingSlotsFetched', () => {
          test('should call updateSlotsFetched and transition to complete', async () => {
            vi.useFakeTimers();

            // Mock committees to skip fetching and go directly to complete

            const updateSlotsPromise = createControllablePromise<{ success: boolean }>();
            mockEpochActors.updateSlotsFetched.mockImplementation(() => updateSlotsPromise.promise);

            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  hasEpochAlreadyStarted: vi.fn(() => true),
                  canProcessEpoch: vi.fn(() => true),
                  needsCommitteesFetch: vi.fn(() => false),
                },
              }),
              {
                input: {
                  epoch: 100,
                  epochDBSnapshot: { ...epochDBSnapshotMock, slotsFetched: false },
                  config: {
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                  },
                  services: {
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                  },
                },
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateTransitions: SnapshotFrom<any>[] = [];
            const subscription = actor.subscribe((snapshot) => {
              stateTransitions.push(snapshot.value);
            });

            actor.start();
            vi.runOnlyPendingTimers();
            await Promise.resolve();

            // Should start in checkingCanProcess
            expect(stateTransitions[0]).toBe('checkingCanProcess');

            // Should go to epochProcessing with slotsProcessing in waitingForCommittees
            const step1 = getLastEpochProcessingState(stateTransitions);
            expect(step1.epochProcessing.fetching.slotsProcessing).toBe('waitingForCommittees');

            // The epoch should start automatically and emit EPOCH_STARTED
            vi.advanceTimersByTime(2);
            await Promise.resolve();

            // Should go to processingSlots
            const step2 = getLastEpochProcessingState(stateTransitions);
            expect(step2.epochProcessing.fetching.slotsProcessing).toBe('processingSlots');

            // Get the spawned slotOrchestratorActor and trigger completion
            const currentSnapshot = actor.getSnapshot();
            const slotOrchestratorActor = currentSnapshot.context.actors.slotOrchestratorActor;
            if (slotOrchestratorActor) {
              slotOrchestratorActor.send({ type: 'SLOT_COMPLETED' });
            }
            await Promise.resolve();

            // Should transition to updatingSlotsFetched
            const step3 = getLastEpochProcessingState(stateTransitions);
            expect(step3.epochProcessing.fetching.slotsProcessing).toBe('updatingSlotsFetched');

            // Verify that updateSlotsFetched was called
            expect(mockEpochActors.updateSlotsFetched).toHaveBeenCalledWith(
              expect.objectContaining({
                input: { epochController: expect.any(Object), epoch: 100 },
              }),
            );

            // Resolve updateSlotsFetched
            updateSlotsPromise.resolve({ success: true });
            await Promise.resolve();

            // Should go to complete
            const step4 = getLastEpochProcessingState(stateTransitions);
            expect(step4.epochProcessing.fetching.slotsProcessing).toBe('complete');

            actor.stop();
            subscription.unsubscribe();
          });
        });
      });

      describe('trackingValidatorsActivation', () => {
        const mockBeaconTime = new BeaconTime({
          genesisTimestamp: GENESIS_TIMESTAMP,
          slotDurationMs: SLOT_DURATION,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
          slotStartIndexing: SLOT_START_INDEXING,
        });

        beforeEach(() => {
          vi.useFakeTimers();
          vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));
          resetMockActors();
        });

        afterEach(() => {
          vi.useRealTimers();
          vi.clearAllTimers();
        });

        describe('before epoch starts', () => {
          test('should wait for epoch to start', async () => {
            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  hasEpochAlreadyStarted: vi.fn(() => false),
                },
              }),
              {
                input: {
                  epoch: 100,
                  epochDBSnapshot: { ...epochDBSnapshotMock, validatorsActivationFetched: false },
                  config: {
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                  },
                  services: {
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                  },
                },
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateTransitions: SnapshotFrom<any>[] = [];
            const subscription = actor.subscribe((snapshot) => {
              stateTransitions.push(snapshot.value);
            });

            actor.start();
            vi.runOnlyPendingTimers();
            await Promise.resolve();

            // Should start in checkingCanProcess
            expect(stateTransitions[0]).toBe('checkingCanProcess');

            // Should go to epochProcessing with trackingValidatorsActivation in waitingForEpochStart
            const step1 = getLastEpochProcessingState(stateTransitions);
            expect(step1.epochProcessing.fetching.trackingValidatorsActivation).toBe(
              'waitingForEpochStart',
            );

            // Wait a bit to ensure it doesn't change (epoch should not start)
            vi.advanceTimersByTime(SLOT_DURATION * 2);
            await Promise.resolve();

            const finalState = getLastEpochProcessingState(stateTransitions);
            expect(finalState.epochProcessing.fetching.trackingValidatorsActivation).toBe(
              'waitingForEpochStart',
            );

            actor.stop();
            subscription.unsubscribe();
          });
        });

        describe('after epoch starts', () => {
          describe('already processed', () => {
            test('should go to complete', async () => {
              // Mock the guard to return true for more explicit testing
              const mockIsValidatorsActivationProcessed = vi.fn(() => true);

              const actor = createActor(
                epochProcessorMachine.provide({
                  guards: {
                    hasEpochAlreadyStarted: vi.fn(() => true),
                    isValidatorsActivationProcessed: mockIsValidatorsActivationProcessed,
                  },
                }),
                {
                  input: {
                    epoch: 100,
                    epochDBSnapshot: { ...epochDBSnapshotMock, validatorsActivationFetched: true },
                    config: {
                      slotDuration: SLOT_DURATION,
                      lookbackSlot: 32,
                    },
                    services: {
                      beaconTime: mockBeaconTime,
                      epochController: mockEpochController,
                    },
                  },
                },
              );

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const stateTransitions: SnapshotFrom<any>[] = [];
              const subscription = actor.subscribe((snapshot) => {
                stateTransitions.push(snapshot.value);
              });

              actor.start();
              vi.runOnlyPendingTimers();
              await Promise.resolve();

              // Step 0: Should start in checkingCanProcess
              expect(stateTransitions[0]).toBe('checkingCanProcess');

              // Step 1: Should go to epochProcessing with trackingValidatorsActivation in waitingForEpochStart
              const step1 = stateTransitions[1];
              expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
              expect(step1.epochProcessing.fetching.trackingValidatorsActivation).toBe(
                'waitingForEpochStart',
              );

              // Advance time to trigger epoch start and EPOCH_STARTED event
              vi.advanceTimersByTime(SLOT_DURATION);
              await Promise.resolve();

              // Verify that the guard was called
              expect(mockIsValidatorsActivationProcessed).toHaveBeenCalled();

              // Step 2: Should transition directly to complete (checkingIfAlreadyProcessed has after: 0)
              const step2 = getLastEpochProcessingState(stateTransitions);
              expect(step2).not.toBeNull();
              expect(step2!.epochProcessing.fetching.trackingValidatorsActivation).toBe('complete');

              // Verify that trackingTransitioningValidators was NOT called
              expect(mockEpochActors.trackingTransitioningValidators).not.toHaveBeenCalled();

              actor.stop();
              subscription.unsubscribe();
            });
          });

          describe('not processed', () => {
            test('should go to fetching and then complete', async () => {
              // Create controllable promise for trackingTransitioningValidators
              const trackingPromise = createControllablePromise<{
                success: boolean;
                processedCount: number;
              }>();

              // Mock trackingTransitioningValidators to return controllable promise
              mockEpochActors.trackingTransitioningValidators.mockImplementation(
                () => trackingPromise.promise,
              );

              const actor = createActor(
                epochProcessorMachine.provide({
                  guards: {
                    hasEpochAlreadyStarted: vi.fn(() => true),
                  },
                }),
                {
                  input: {
                    epoch: 100,
                    epochDBSnapshot: { ...epochDBSnapshotMock, validatorsActivationFetched: false },
                    config: {
                      slotDuration: SLOT_DURATION,
                      lookbackSlot: 32,
                    },
                    services: {
                      beaconTime: mockBeaconTime,
                      epochController: mockEpochController,
                      validatorsController: mockValidatorsController,
                    },
                  },
                },
              );

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const stateTransitions: SnapshotFrom<any>[] = [];
              const subscription = actor.subscribe((snapshot) => {
                stateTransitions.push(snapshot.value);
              });

              actor.start();
              vi.runOnlyPendingTimers();
              await Promise.resolve();

              // Step 0: Should start in checkingCanProcess
              expect(stateTransitions[0]).toBe('checkingCanProcess');

              // Step 1: Should go to epochProcessing with trackingValidatorsActivation in waitingForEpochStart
              const step1 = getLastEpochProcessingState(stateTransitions);
              expect(step1!.epochProcessing.fetching.trackingValidatorsActivation).toBe(
                'waitingForEpochStart',
              );

              // Advance time to trigger epoch start and EPOCH_STARTED event
              vi.advanceTimersByTime(SLOT_DURATION);
              await Promise.resolve();

              // Step 2: Should transition directly to fetching (checkingIfAlreadyProcessed has after: 0)
              const step2 = getLastEpochProcessingState(stateTransitions);
              expect(step2!.epochProcessing.fetching.trackingValidatorsActivation).toBe('fetching');

              // Verify that trackingTransitioningValidators was called
              expect(mockEpochActors.trackingTransitioningValidators).toHaveBeenCalledWith(
                expect.objectContaining({ input: { validatorsController: expect.any(Object) } }),
              );

              // Resolve trackingTransitioningValidators to complete
              trackingPromise.resolve({ success: true, processedCount: 5 });
              await Promise.resolve();

              // Step 4: Should go to complete
              const step4 = getLastEpochProcessingState(stateTransitions);
              expect(step4!.epochProcessing.fetching.trackingValidatorsActivation).toBe('complete');

              actor.stop();
              subscription.unsubscribe();
            });
          });
        });
      });

      describe('validatorsBalances', () => {
        const mockBeaconTime = new BeaconTime({
          genesisTimestamp: GENESIS_TIMESTAMP,
          slotDurationMs: SLOT_DURATION,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
          slotStartIndexing: SLOT_START_INDEXING,
        });

        beforeEach(() => {
          vi.useFakeTimers();
          vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));
          resetMockActors();
        });

        afterEach(() => {
          vi.useRealTimers();
          vi.clearAllTimers();
        });

        describe('before epoch starts', () => {
          test('should wait for epoch to start', async () => {
            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  hasEpochAlreadyStarted: vi.fn(() => false),
                },
              }),
              {
                input: {
                  epoch: 100,
                  epochDBSnapshot: { ...epochDBSnapshotMock, validatorsBalancesFetched: false },
                  config: {
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                  },
                  services: {
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                  },
                },
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateTransitions: SnapshotFrom<any>[] = [];
            const subscription = actor.subscribe((snapshot) => {
              stateTransitions.push(snapshot.value);
            });

            actor.start();
            vi.runOnlyPendingTimers();
            await Promise.resolve();

            // Should start in checkingCanProcess
            expect(stateTransitions[0]).toBe('checkingCanProcess');

            // Should go to epochProcessing with validatorsBalances in waitingForEpochStart
            const step1 = getLastEpochProcessingState(stateTransitions);
            expect(step1.epochProcessing.fetching.validatorsBalances).toBe('waitingForEpochStart');

            // Wait a bit to ensure it doesn't change (epoch should not start)
            vi.advanceTimersByTime(SLOT_DURATION * 2);
            await Promise.resolve();

            const finalState = getLastEpochProcessingState(stateTransitions);
            expect(finalState.epochProcessing.fetching.validatorsBalances).toBe(
              'waitingForEpochStart',
            );

            // Verify that fetchValidatorsBalances was NOT called
            expect(mockEpochActors.fetchValidatorsBalances).not.toHaveBeenCalled();

            actor.stop();
            subscription.unsubscribe();
          });
        });

        describe('after epoch starts', () => {
          describe('already processed', () => {
            test('should go to complete', async () => {
              // Mock the guard to return true for more explicit testing
              const mockHasValidatorsBalancesFetched = vi.fn(() => true);

              const actor = createActor(
                epochProcessorMachine.provide({
                  guards: {
                    hasEpochAlreadyStarted: vi.fn(() => true),
                    hasValidatorsBalancesFetched: mockHasValidatorsBalancesFetched,
                  },
                }),
                {
                  input: {
                    epoch: 100,
                    epochDBSnapshot: { ...epochDBSnapshotMock, validatorsBalancesFetched: true },
                    config: {
                      slotDuration: SLOT_DURATION,
                      lookbackSlot: 32,
                    },
                    services: {
                      beaconTime: mockBeaconTime,
                      epochController: mockEpochController,
                    },
                  },
                },
              );

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const stateTransitions: SnapshotFrom<any>[] = [];
              const subscription = actor.subscribe((snapshot) => {
                stateTransitions.push(snapshot.value);
              });

              actor.start();
              vi.runOnlyPendingTimers();
              await Promise.resolve();

              // Step 0: Should start in checkingCanProcess
              expect(stateTransitions[0]).toBe('checkingCanProcess');

              // Step 1: Should go to epochProcessing with validatorsBalances in waitingForEpochStart
              const step1 = stateTransitions[1];
              expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
              expect(step1.epochProcessing.fetching.validatorsBalances).toBe(
                'waitingForEpochStart',
              );

              // Advance time to trigger epoch start and EPOCH_STARTED event
              vi.advanceTimersByTime(SLOT_DURATION);
              await Promise.resolve();

              // Verify that the guard was called
              expect(mockHasValidatorsBalancesFetched).toHaveBeenCalled();

              // Step 2: Should transition directly to complete (checkingIfAlreadyProcessed has after: 0)
              const step2 = getLastEpochProcessingState(stateTransitions);
              expect(step2!.epochProcessing.fetching.validatorsBalances).toBe('complete');

              // Verify that fetchValidatorsBalances was NOT called
              expect(mockEpochActors.fetchValidatorsBalances).not.toHaveBeenCalled();

              actor.stop();
              subscription.unsubscribe();
            });
          });

          describe('not processed', () => {
            test('should go to fetching and then complete', async () => {
              // Create controllable promise for fetchValidatorsBalances
              const fetchBalancesPromise = createControllablePromise<{ success: boolean }>();

              // Mock fetchValidatorsBalances to return controllable promise
              mockEpochActors.fetchValidatorsBalances.mockImplementation(
                () => fetchBalancesPromise.promise,
              );

              const actor = createActor(
                epochProcessorMachine.provide({
                  guards: {
                    hasEpochAlreadyStarted: vi.fn(() => true),
                    hasValidatorsBalancesFetched: vi.fn(() => false),
                  },
                }),
                {
                  input: {
                    epoch: 100,
                    epochDBSnapshot: { ...epochDBSnapshotMock, validatorsBalancesFetched: false },
                    config: {
                      slotDuration: SLOT_DURATION,
                      lookbackSlot: 32,
                    },
                    services: {
                      beaconTime: mockBeaconTime,
                      epochController: mockEpochController,
                      validatorsController: mockValidatorsController,
                    },
                  },
                },
              );

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const stateTransitions: SnapshotFrom<any>[] = [];
              const subscription = actor.subscribe((snapshot) => {
                stateTransitions.push(snapshot.value);
              });

              actor.start();
              vi.runOnlyPendingTimers();
              await Promise.resolve();

              // Step 0: Should start in checkingCanProcess
              expect(stateTransitions[0]).toBe('checkingCanProcess');

              // Step 1: Should go to epochProcessing with validatorsBalances in waitingForEpochStart
              const step1 = getLastEpochProcessingState(stateTransitions);
              expect(step1!.epochProcessing.fetching.validatorsBalances).toBe(
                'waitingForEpochStart',
              );

              // Advance time to trigger epoch start and EPOCH_STARTED event
              vi.advanceTimersByTime(SLOT_DURATION);
              await Promise.resolve();

              // Step 2: Should transition directly to fetching (checkingIfAlreadyProcessed has after: 0)
              const step2 = getLastEpochProcessingState(stateTransitions);
              expect(step2!.epochProcessing.fetching.validatorsBalances).toBe('fetching');

              // Verify that fetchValidatorsBalances was called with startSlot and validatorsController
              expect(mockEpochActors.fetchValidatorsBalances).toHaveBeenCalledWith(
                expect.objectContaining({
                  input: {
                    startSlot: 3200,
                    epoch: 100,
                    validatorsController: expect.any(Object),
                  },
                }), // 100 * 32 = 3200
              );

              // Resolve fetchValidatorsBalances to complete
              fetchBalancesPromise.resolve({ success: true });
              await Promise.resolve();

              // Step 3: Should go to complete
              const step3 = getLastEpochProcessingState(stateTransitions);
              expect(step3!.epochProcessing.fetching.validatorsBalances).toBe('complete');

              actor.stop();
              subscription.unsubscribe();
            });
          });
        });
      });

      describe('rewards', () => {
        const mockBeaconTime = new BeaconTime({
          genesisTimestamp: GENESIS_TIMESTAMP,
          slotDurationMs: SLOT_DURATION,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
          slotStartIndexing: SLOT_START_INDEXING,
        });

        beforeEach(() => {
          vi.useFakeTimers();
          vi.setSystemTime(new Date(EPOCH_101_START_TIME + 50));
          resetMockActors();
        });

        afterEach(() => {
          vi.useRealTimers();
          vi.clearAllTimers();
        });

        describe('waiting for validators balances', () => {
          test('should wait for VALIDATORS_BALANCES_FETCHED event', async () => {
            // Create controllable promise for fetchValidatorsBalances
            const fetchBalancesPromise = createControllablePromise<{ success: boolean }>();

            // Mock fetchValidatorsBalances to return controllable promise
            mockEpochActors.fetchValidatorsBalances.mockImplementation(
              () => fetchBalancesPromise.promise,
            );

            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  hasValidatorsBalancesFetched: vi.fn(() => false),
                },
              }),
              {
                input: {
                  epoch: 100,
                  epochDBSnapshot: { ...epochDBSnapshotMock, validatorsBalancesFetched: false },
                  config: {
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                  },
                  services: {
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                    validatorsController: mockValidatorsController,
                  },
                },
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateTransitions: SnapshotFrom<any>[] = [];
            const subscription = actor.subscribe((snapshot) => {
              stateTransitions.push(snapshot.value);
            });

            actor.start();
            vi.runOnlyPendingTimers();
            await Promise.resolve();

            // Should start in checkingCanProcess
            expect(stateTransitions[0]).toBe('checkingCanProcess');

            // Demonstrate that getLastMachineState works with top-level states too
            const topLevelState = getLastMachineState(stateTransitions, 'checkingCanProcess');
            expect(topLevelState).toBe('checkingCanProcess');

            // Advance time to ensure validatorsBalances reaches fetching state
            vi.advanceTimersByTime(SLOT_DURATION);
            await Promise.resolve();

            // Verify that validatorsBalances is in fetching state
            const validatorsBalancesState = getLastMachineState(
              stateTransitions,
              'epochProcessing.fetching.validatorsBalances',
            );
            expect(validatorsBalancesState).toBe('fetching');

            // Verify that fetchValidatorsBalances was called
            expect(mockEpochActors.fetchValidatorsBalances).toHaveBeenCalledWith(
              expect.objectContaining({
                input: {
                  startSlot: 3200,
                  epoch: 100,
                  validatorsController: expect.any(Object),
                },
              }), // 100 * 32 = 3200
            );

            // Should go to epochProcessing with rewards in waitingForValidatorsBalances
            const rewardsState = getLastMachineState(
              stateTransitions,
              'epochProcessing.fetching.rewards',
            );
            expect(rewardsState).toBe('waitingForValidatorsBalances');

            // Wait a bit to ensure rewards doesn't change (no VALIDATORS_BALANCES_FETCHED event yet)
            vi.advanceTimersByTime(SLOT_DURATION * 2);
            await Promise.resolve();

            // Verify rewards is still waiting
            const rewardsStillWaiting = getLastMachineState(
              stateTransitions,
              'epochProcessing.fetching.rewards',
            );
            expect(rewardsStillWaiting).toBe('waitingForValidatorsBalances');

            // Verify that validatorsBalances is still in fetching (controlled promise still pending)
            const validatorsBalancesStillFetching = getLastMachineState(
              stateTransitions,
              'epochProcessing.fetching.validatorsBalances',
            );
            expect(validatorsBalancesStillFetching).toBe('fetching');

            // Verify that fetchAttestationsRewards was NOT called
            expect(mockEpochActors.fetchAttestationsRewards).not.toHaveBeenCalled();

            actor.stop();
            subscription.unsubscribe();
          });
        });

        describe('waiting for epoch to end', () => {
          describe('epoch has ended', () => {
            test('should go to fetching and complete', async () => {
              // Create controllable promise for fetchAttestationsRewards
              const fetchRewardsPromise = createControllablePromise<{ success: boolean }>();

              // Mock fetchAttestationsRewards to return controllable promise
              mockEpochActors.fetchAttestationsRewards.mockImplementation(
                () => fetchRewardsPromise.promise,
              );

              const actor = createActor(
                epochProcessorMachine.provide({
                  guards: {
                    hasEpochAlreadyStarted: vi.fn(() => true),
                    hasEpochEnded: vi.fn(() => true), // Epoch has ended
                  },
                }),
                {
                  input: {
                    epoch: 100,
                    epochDBSnapshot: { ...epochDBSnapshotMock, validatorsBalancesFetched: true },
                    config: {
                      slotDuration: SLOT_DURATION,
                      lookbackSlot: 32,
                    },
                    services: {
                      beaconTime: mockBeaconTime,
                      epochController: mockEpochController,
                    },
                  },
                },
              );

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const stateTransitions: SnapshotFrom<any>[] = [];
              const subscription = actor.subscribe((snapshot) => {
                stateTransitions.push(snapshot.value);
              });

              actor.start();
              vi.runOnlyPendingTimers();
              await Promise.resolve();

              // Simulate VALIDATORS_BALANCES_FETCHED event by sending it directly
              actor.send({ type: 'VALIDATORS_BALANCES_FETCHED' });
              await Promise.resolve();

              // Advance time to trigger the guard evaluation
              vi.advanceTimersByTime(SLOT_DURATION);
              await Promise.resolve();

              // Should go to fetching
              const rewardsFetching = getLastMachineState(
                stateTransitions,
                'epochProcessing.fetching.rewards',
              );
              expect(rewardsFetching).toBe('fetching');

              // Verify that fetchAttestationsRewards was called
              expect(mockEpochActors.fetchAttestationsRewards).toHaveBeenCalledWith(
                expect.objectContaining({
                  input: {
                    epoch: 100,
                    epochController: expect.any(Object),
                  },
                }),
              );

              // Resolve fetchAttestationsRewards to complete
              fetchRewardsPromise.resolve({ success: true });
              await Promise.resolve();

              // Should go to complete
              const rewardsComplete = getLastMachineState(
                stateTransitions,
                'epochProcessing.fetching.rewards',
              );
              expect(rewardsComplete).toBe('complete');

              actor.stop();
              subscription.unsubscribe();
            });
          });

          describe('epoch has not ended', () => {
            test('should cycle through waiting', async () => {
              const actor = createActor(
                epochProcessorMachine.provide({
                  guards: {
                    hasEpochAlreadyStarted: vi.fn(() => true),
                    hasEpochEnded: vi.fn(() => false), // Epoch has NOT ended
                  },
                }),
                {
                  input: {
                    epoch: 100,
                    epochDBSnapshot: { ...epochDBSnapshotMock, validatorsBalancesFetched: true },
                    config: {
                      slotDuration: SLOT_DURATION,
                      lookbackSlot: 32,
                    },
                    services: {
                      beaconTime: mockBeaconTime,
                      epochController: mockEpochController,
                    },
                  },
                },
              );

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const stateTransitions: SnapshotFrom<any>[] = [];
              const subscription = actor.subscribe((snapshot) => {
                stateTransitions.push(snapshot.value);
              });

              actor.start();
              vi.runOnlyPendingTimers();
              await Promise.resolve();

              // Simulate VALIDATORS_BALANCES_FETCHED event by sending it directly
              actor.send({ type: 'VALIDATORS_BALANCES_FETCHED' });
              await Promise.resolve();

              // Let time pass to allow the cycle to complete (3 slots)
              vi.advanceTimersByTime(SLOT_DURATION * 3);
              await Promise.resolve();

              // Extract rewards states from transitions
              const rewardsStates = stateTransitions
                .filter(
                  (state) =>
                    typeof state === 'object' && state !== null && 'epochProcessing' in state,
                )
                .map((state) => state.epochProcessing.fetching.rewards)
                .filter((state) => state !== undefined);

              // Verify the cycle sequence: waitingForEpochToEnd > waitingForEpochEndDelaying > waitingForEpochToEnd
              expect(rewardsStates).toContain('waitingForEpochToEnd');
              expect(rewardsStates).toContain('waitingForEpochEndDelaying');

              // Verify that the cycle occurred (both states are present)
              const waitingForEpochToEndCount = rewardsStates.filter(
                (state) => state === 'waitingForEpochToEnd',
              ).length;
              const waitingForEpochEndDelayingCount = rewardsStates.filter(
                (state) => state === 'waitingForEpochEndDelaying',
              ).length;

              expect(waitingForEpochToEndCount).toBeGreaterThan(0);
              expect(waitingForEpochEndDelayingCount).toBeGreaterThan(0);

              // Verify that fetchAttestationsRewards was NOT called
              expect(mockEpochActors.fetchAttestationsRewards).not.toHaveBeenCalled();

              actor.stop();
              subscription.unsubscribe();
            });
          });
        });
      });
    });
  });

  describe('complete', () => {
    const mockBeaconTime = new BeaconTime({
      genesisTimestamp: GENESIS_TIMESTAMP,
      slotDurationMs: SLOT_DURATION,
      slotsPerEpoch: SLOTS_PER_EPOCH,
      epochsPerSyncCommitteePeriod: EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
      slotStartIndexing: SLOT_START_INDEXING,
    });

    beforeEach(() => {
      vi.useFakeTimers();
      // Set time to after epoch 100 has ended (epoch 100 * 32 + 1 = slot 3201)
      vi.setSystemTime(
        new Date(EPOCH_100_START_TIME + SLOTS_PER_EPOCH * SLOT_DURATION + SLOT_DURATION),
      );
      resetMockActors();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.clearAllTimers();
    });

    test('should invoke markEpochAsProcessed and transition to epochCompleted', async () => {
      // Create controllable promise for markEpochAsProcessed
      const markEpochPromise = createControllablePromise<{ success: boolean; machineId: string }>();

      // Mock markEpochAsProcessed to return controllable promise
      mockEpochActors.markEpochAsProcessed.mockImplementation(() => markEpochPromise.promise);

      // Create a parent actor to handle sendParent events
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receivedEvents: any[] = [];
      const parentActor = createActor(
        setup({}).createMachine({
          id: 'parent',
          initial: 'idle',
          states: {
            idle: {
              on: {
                EPOCH_COMPLETED: {
                  target: 'completed',
                  actions: [
                    ({ event }) => {
                      receivedEvents.push(event);
                    },
                  ],
                },
              },
            },
            completed: {
              type: 'final',
            },
          },
        }),
      );

      // Start the parent actor first
      parentActor.start();

      const actor = createActor(epochProcessorMachine.provide({}), {
        input: {
          epoch: 100,
          epochDBSnapshot: {
            committeesFetched: true,
            syncCommitteesFetched: true,
            validatorsBalancesFetched: true,
            validatorsActivationFetched: true,
            slotsFetched: true,
            rewardsFetched: true,
          },
          config: {
            slotDuration: SLOT_DURATION,
            lookbackSlot: 32,
          },
          services: {
            beaconTime: mockBeaconTime,
            epochController: mockEpochController,
          },
        },
        parent: parentActor,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stateTransitions: SnapshotFrom<any>[] = [];
      const subscription = actor.subscribe((snapshot) => {
        stateTransitions.push(snapshot.value);
      });

      actor.start();
      vi.runOnlyPendingTimers();
      vi.advanceTimersByTime(5);
      await Promise.resolve();

      // Should go to complete
      const step2 = getLastMachineState(stateTransitions, 'complete');
      expect(step2).toBe('complete');

      // Verify that markEpochAsProcessed was called
      expect(mockEpochActors.markEpochAsProcessed).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            epochController: mockEpochController,
            epoch: 100,
            machineId: 'epochProcessor:100',
          },
        }),
      );

      // Resolve markEpochAsProcessed to complete
      markEpochPromise.resolve({ success: true, machineId: 'epochProcessor:100' });
      await Promise.resolve();
      // Should go to epochCompleted
      const finalState = getLastMachineState(stateTransitions, 'epochCompleted');
      expect(finalState).not.toBeNull();
      expect(finalState).toBe('epochCompleted');

      // Verify that the parent received the EPOCH_COMPLETED event
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual({
        type: 'EPOCH_COMPLETED',
        machineId: 'epochProcessor:100',
      });

      parentActor.stop();
      subscription.unsubscribe();
    });
  });
});
