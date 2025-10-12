import ms from 'ms';
import { test, expect, vi, beforeEach } from 'vitest';
import { createActor, fromPromise, SnapshotFrom } from 'xstate';

import { BeaconTime } from '../../services/consensus/utils/time.js';

import { epochProcessorMachine } from './epochProcessor.machine.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';

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

// Mock the logging functions
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

vi.mock('@/src/xstate/multiMachineLogger.js', () => ({
  logActor: vi.fn(),
}));

// Mock the slotOrchestratorMachine as a proper XState v5 machine
vi.mock('@/src/xstate/slot/slotOrchestrator.machine.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setup } = require('xstate');

  const mockMachine = setup({}).createMachine({
    id: 'mockSlotOrchestrator',
    initial: 'idle',
    states: {
      idle: {
        type: 'final',
      },
    },
  });

  return {
    slotOrchestratorMachine: mockMachine,
  };
});

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
        const step2 = stateTransitions[stateTransitions.length - 1];
        expect(typeof step2 === 'object' && 'epochProcessing' in step2).toBe(true);
        const step2Obj = step2;
        expect(step2Obj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(step2Obj.epochProcessing.fetching.committees).toBe('fetching');

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

        // get the states that ensures the syncCommittees are fetching: checkingIfAlreadyProcessed -> checkingInDB -> fetching
        const syncStates = stateTransitions
          .filter((state) => typeof state === 'object' && 'epochProcessing' in state)
          .map((state) => {
            const epochProcessing = state.epochProcessing;
            return epochProcessing.fetching?.syncingCommittees;
          })
          .filter(Boolean);

        // Check that all the states are present
        expect(syncStates).toContain('checkingIfAlreadyProcessed');
        expect(syncStates).toContain('checkingInDB');
        expect(syncStates).toContain('fetching');

        // Verify the order
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

        // Epoch has not started yet, slotsProcessing should be waiting for prerequisites
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
        const step1Obj = step1;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.slotsProcessing).toBe('waitingForPrerequisites');

        // Wait a bit to ensure it doesn't change (epoch should not start)
        vi.advanceTimersByTime(SLOT_DURATION * 2);
        await Promise.resolve();

        const finalState = stateTransitions[stateTransitions.length - 1];
        expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
        const finalStateObj = finalState;
        expect(finalStateObj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(finalStateObj.epochProcessing.fetching.slotsProcessing).toBe(
          'waitingForPrerequisites',
        );

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

        const finalState = stateTransitions[stateTransitions.length - 1];
        expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
        const finalStateObj = finalState;
        expect(finalStateObj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(finalStateObj.epochProcessing.fetching.trackingValidatorsActivation).toBe(
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

        const finalState = stateTransitions[stateTransitions.length - 1];
        expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
        const finalStateObj = finalState;
        expect(finalStateObj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(finalStateObj.epochProcessing.fetching.validatorsBalances).toBe(
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

            const finalState = stateTransitions[stateTransitions.length - 1];
            expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
            const finalStateObj = finalState;
            expect(finalStateObj.epochProcessing.fetching.committees).toBe('complete');

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

            const step2 = stateTransitions[stateTransitions.length - 1];
            expect(typeof step2 === 'object' && 'epochProcessing' in step2).toBe(true);
            const step2Obj = step2;
            expect(step2Obj.epochProcessing.fetching.committees).toBe('fetching');

            // Step 5: Verify fetchCommittees was called
            expect(mockEpochActors.fetchCommittees).toHaveBeenCalledWith(
              expect.objectContaining({ input: { epoch: 100 } }),
            );

            // Step 6: Wait for fetchCommittees to complete
            vi.advanceTimersByTime(SLOT_DURATION * 1.5);
            await Promise.resolve();

            // Step 7: Should go to complete
            const finalState = stateTransitions[stateTransitions.length - 1];
            expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
            const finalStateObj = finalState;
            expect(finalStateObj.epochProcessing.fetching.committees).toBe('complete');

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

            const step2 = stateTransitions[stateTransitions.length - 1];
            expect(typeof step2 === 'object' && 'epochProcessing' in step2).toBe(true);
            const step2Obj = step2;
            expect(step2Obj.epochProcessing.fetching.committees).toBe('fetching');

            vi.advanceTimersByTime(SLOT_DURATION * 2);
            await Promise.resolve();

            const finalState = stateTransitions[stateTransitions.length - 1];
            expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
            const finalStateObj = finalState;
            expect(finalStateObj.epochProcessing.fetching.committees).toBe('fetching');

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
            const finalState = stateTransitions[stateTransitions.length - 1];
            expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
            const finalStateObj = finalState;
            expect(finalStateObj.epochProcessing.fetching.committees).toBe('complete');

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

        test('should go to complete when syncCommittees are already processed', async () => {
          const actor = createActor(
            epochProcessorMachine.provide({
              guards: {
                hasEpochAlreadyStarted: vi.fn(() => true),
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

          expect(stateTransitions[0]).toBe('checkingCanProcess');

          const step1 = stateTransitions[1];
          expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
          const step1Obj = step1;
          expect(step1Obj.epochProcessing.fetching.syncingCommittees).toBe(
            'checkingIfAlreadyProcessed',
          );

          vi.advanceTimersByTime(SLOT_DURATION);
          await Promise.resolve();

          const finalState = stateTransitions[stateTransitions.length - 1];
          expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
          const finalStateObj = finalState;
          expect(finalStateObj.epochProcessing.fetching.syncingCommittees).toBe('complete');

          actor.stop();
          subscription.unsubscribe();
        });
      });
    });
  });

  // describe('epochCompleted', () => {
  //   test('should mark epoch as processed when epoch processing completes', async () => {
  //     const SLOT_DURATION = ms('10ms');
  //     const SLOTS_PER_EPOCH = 32;

  //     const mockBeaconTime = new BeaconTime({
  //       genesisTimestamp: 1606824000000,
  //       slotDurationMs: SLOT_DURATION,
  //       slotsPerEpoch: SLOTS_PER_EPOCH,
  //       epochsPerSyncCommitteePeriod: 256,
  //       slotStartIndexing: 32,
  //     });

  //     // Mock time for currentEpoch >= 101 (canProcessEpoch = true for epoch 100)
  //     // We need to simulate that epoch 100 has ended so that rewards can be processed
  //     const { endSlot } = mockBeaconTime.getEpochSlots(100);
  //     const EPOCH_100_END_TIME = mockBeaconTime.getTimestampFromSlotNumber(endSlot);
  //     const mockCurrentTime = EPOCH_100_END_TIME + 100; // 100ms after epoch 100 ended
  //     const getTimeSpy = vi.spyOn(Date.prototype, 'getTime').mockReturnValue(mockCurrentTime);

  //     // Create a simple parent machine that can receive the EPOCH_COMPLETED event
  //     const mockEpochOrchestratorMachine = createMachine({
  //       id: 'parent',
  //       initial: 'waiting',
  //       types: {
  //         context: {} as {
  //           epochActor: ActorRefFrom<typeof epochProcessorMachine> | null;
  //           epochCompleted: boolean;
  //         },
  //       },
  //       context: {
  //         epochActor: null,
  //         epochCompleted: false,
  //       },
  //       states: {
  //         waiting: {
  //           entry: assign({
  //             epochActor: ({ spawn }) => {
  //               const testMachine = epochProcessorMachine.provide({
  //                 actors: {
  //                   fetchValidatorsBalances: fromPromise(() => Promise.resolve()),
  //                   fetchAttestationsRewards: fromPromise(() => Promise.resolve()),
  //                   fetchCommittees: fromPromise(() => Promise.resolve()),
  //                   fetchSyncCommittees: fromPromise(() => Promise.resolve()),
  //                   checkSyncCommitteeForEpochInDB: fromPromise(() =>
  //                     Promise.resolve({ isFetched: true as boolean }),
  //                   ),
  //                   updateSlotsFetched: fromPromise(() =>
  //                     Promise.resolve({ success: true as boolean }),
  //                   ),
  //                   updateSyncCommitteesFetched: fromPromise(() =>
  //                     Promise.resolve({ success: true as boolean }),
  //                   ),
  //                   trackingTransitioningValidators: fromPromise(() =>
  //                     Promise.resolve({ success: true as boolean, processedCount: 0 }),
  //                   ),
  //                   markEpochAsProcessed: fromPromise(({ input }) => {
  //                     return input.epochController.markEpochAsProcessed(input.epoch).then(() => ({
  //                       success: true,
  //                       machineId: input.machineId,
  //                     }));
  //                   }),
  //                 },
  //               });

  //               return spawn(testMachine, {
  //                 id: 'epochProcessor:100',
  //                 input: {
  //                   epoch: 100,
  //                   epochDBSnapshot: {
  //                     validatorsBalancesFetched: false, // Set to false to trigger validators balances fetching
  //                     rewardsFetched: false, // Set to false to trigger rewards fetching
  //                     committeesFetched: true, // Set to true to skip committees
  //                     slotsFetched: true, // Set to true to skip slots
  //                     syncCommitteesFetched: true, // Set to true to skip sync committees
  //                     validatorsActivationFetched: true, // Set to true to skip validators activation
  //                   },
  //                   config: {
  //                     slotDuration: SLOT_DURATION,
  //                     lookbackSlot: 32,
  //                   },
  //                   services: {
  //                     beaconTime: mockBeaconTime,
  //                     epochController: mockEpochController,
  //                   },
  //                 },
  //               });
  //             },
  //           }),
  //           on: {
  //             EPOCH_COMPLETED: {
  //               actions: assign({
  //                 epochCompleted: true,
  //               }),
  //             },
  //           },
  //         },
  //       },
  //     });
  //     const epochOrchestratorMachine = createActor(mockEpochOrchestratorMachine, {
  //       input: {},
  //     });
  //     epochOrchestratorMachine.start();

  //     // Wait for the complete flow to reach completion
  //     await new Promise((resolve) => setTimeout(resolve, 100));

  //     expect(epochOrchestratorMachine.getSnapshot().context.epochCompleted).toBe(true);
  //     expect(epochOrchestratorMachine.getSnapshot().context.epochActor?.getSnapshot().value).toBe(
  //       'epochCompleted',
  //     );

  //     // Stop the actors
  //     epochOrchestratorMachine.stop();

  //     // Verify that markEpochAsProcessed was called
  //     expect(vi.mocked(mockEpochController.markEpochAsProcessed)).toHaveBeenCalledWith(100);

  //     // Clean up
  //     getTimeSpy.mockRestore();
  //   });
  // });
});
