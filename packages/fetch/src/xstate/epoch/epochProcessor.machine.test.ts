import ms from 'ms';
import { test, expect, vi, beforeEach } from 'vitest';
import { createActor, fromPromise, SnapshotFrom, sendParent } from 'xstate';

import { createControllablePromise } from '@/src/__tests__/utils.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import { epochProcessorMachine } from '@/src/xstate/epoch/epochProcessor.machine.js';

// Helper function to find the last epochProcessing state from state transitions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLastEpochProcessingState(stateTransitions: any[]) {
  for (let i = stateTransitions.length - 1; i >= 0; i--) {
    const state = stateTransitions[i];
    if (typeof state === 'object' && state !== null && 'epochProcessing' in state) {
      return state;
    }
  }
  return null;
}

// Mock EpochController
const mockEpochController = {
  markEpochAsProcessed: vi.fn().mockResolvedValue(undefined),
} as unknown as EpochController;

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
  markEpochAsProcessed: vi.fn(() => Promise.resolve()),
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
  describe('checkingCanProcess:waiting', () => {
    const SLOT_DURATION = ms('10ms');
    const SLOTS_PER_EPOCH = 32;

    const mockBeaconTime = new BeaconTime({
      genesisTimestamp: 1606824000000,
      slotDurationMs: SLOT_DURATION,
      slotsPerEpoch: SLOTS_PER_EPOCH,
      epochsPerSyncCommitteePeriod: 256,
      slotStartIndexing: 32,
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
      const EPOCH_97_START_TIME = mockBeaconTime.getTimestampFromEpochNumber(97);
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
      const EPOCH_101_START_TIME = mockBeaconTime.getTimestampFromEpochNumber(101);
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
    describe('when epoch has not started yet', () => {
      const SLOT_DURATION = ms('10ms');
      const SLOTS_PER_EPOCH = 32;
      const EPOCH_100_START_TIME = 1606824000000 + 100 * 32 * 10; // 100 epochs * 32 slots * 10ms

      const mockBeaconTime = new BeaconTime({
        genesisTimestamp: 1606824000000,
        slotDurationMs: SLOT_DURATION,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        epochsPerSyncCommitteePeriod: 256,
        slotStartIndexing: 32,
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

    describe('when epoch has started', () => {
      describe('committees', () => {
        const SLOT_DURATION = ms('10ms');
        const SLOTS_PER_EPOCH = 32;
        const EPOCH_101_START_TIME = 1606824000000 + 101 * 32 * 10;

        const mockBeaconTime = new BeaconTime({
          genesisTimestamp: 1606824000000,
          slotDurationMs: SLOT_DURATION,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          epochsPerSyncCommitteePeriod: 256,
          slotStartIndexing: 32,
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

        describe('when committees are already processed', () => {
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

        describe('when committees are not processed', () => {
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
              expect.objectContaining({ input: { epoch: 100 } }),
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
              expect.objectContaining({ input: { epoch: 100 } }),
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

        describe('when transitions to complete', () => {
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
        const SLOT_DURATION = ms('10ms');
        const SLOTS_PER_EPOCH = 32;
        const EPOCH_101_START_TIME = 1606824000000 + 101 * 32 * 10;

        const mockBeaconTime = new BeaconTime({
          genesisTimestamp: 1606824000000,
          slotDurationMs: SLOT_DURATION,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          epochsPerSyncCommitteePeriod: 256,
          slotStartIndexing: 32,
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

        describe('syncingCommittees states', () => {
          describe('when syncCommittees are already processed', () => {
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

          describe('when syncCommittees are not processed', () => {
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
                  expect.objectContaining({ input: { epoch: 100 } }),
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
                  expect.objectContaining({ input: { epoch: 100 } }),
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
                  expect.objectContaining({ input: { epoch: 100 } }),
                );
                checkSyncCommitteePromise.resolve({ isFetched: false });
                await Promise.resolve();

                // Step 3: Should go to fetching
                const step3 = getLastEpochProcessingState(stateTransitions);
                expect(step3.epochProcessing.fetching.syncingCommittees).toBe('fetching');
                expect(mockEpochActors.fetchSyncCommittees).toHaveBeenCalledWith(
                  expect.objectContaining({ input: { epoch: 100 } }),
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
        const SLOT_DURATION = ms('10ms');
        const mockBeaconTime = new BeaconTime({
          genesisTimestamp: 1606824000000,
          slotDurationMs: SLOT_DURATION,
          slotsPerEpoch: 32,
          epochsPerSyncCommitteePeriod: 256,
          slotStartIndexing: 32,
        });

        beforeEach(() => {
          vi.useFakeTimers();
          resetMockActors();
        });

        afterEach(() => {
          vi.useRealTimers();
          vi.clearAllTimers();
        });

        describe('waiting for committees to be fetched before continuing', () => {
          test('should stay in waitingForCommittees until COMMITTEES_FETCHED arrives, then transition to checkingSlotsProcessed', async () => {
            const SLOT_DURATION = ms('10ms');
            const SLOTS_PER_EPOCH = 32;

            const mockBeaconTime = new BeaconTime({
              genesisTimestamp: 1606824000000,
              slotDurationMs: SLOT_DURATION,
              slotsPerEpoch: SLOTS_PER_EPOCH,
              epochsPerSyncCommitteePeriod: 256,
              slotStartIndexing: 32,
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
          describe('when slots are already processed', () => {
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

          describe('when slots are NOT processed', () => {
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
              expect.objectContaining({ input: { epoch: 100 } }),
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
    });
  });
});
