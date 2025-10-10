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

      vi.advanceTimersByTime(20);
      await Promise.resolve();

      const finalState = stateTransitions[stateTransitions.length - 1];
      expect(finalState).toBe('waiting');

      actor.stop();
      subscription.unsubscribe();
    });

    test('should cycle between checkingCanProcess and waiting when epoch is too early', async () => {
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
      expect(stateTransitions[1]).toBe('waiting');

      vi.advanceTimersByTime(5);
      await Promise.resolve();

      expect(stateTransitions[2]).toBe('checkingCanProcess');

      vi.advanceTimersByTime(5);
      await Promise.resolve();

      expect(stateTransitions[3]).toBe('waiting');

      actor.stop();
      subscription.unsubscribe();
    });

    test('can process epoch (1 epoch in advance), should go to epochProcessing', async () => {
      const EPOCH_101_START_TIME = mockBeaconTime.getTimestampFromEpochNumber(101);
      const mockCurrentTime = EPOCH_101_START_TIME + 50;
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

      vi.advanceTimersByTime(10);
      await Promise.resolve();

      const finalState = stateTransitions[stateTransitions.length - 1];
      expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);

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

        // Epoch has not started yet, committees should be in checkingIfAlreadyProcessed
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
        const step1Obj = step1;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.committees).toBe('checkingIfAlreadyProcessed');

        // Wait some time
        vi.advanceTimersByTime(10);
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
        const step1Obj = step1;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.syncingCommittees).toBe(
          'checkingIfAlreadyProcessed',
        );

        // Wait for syncCommittees to transition to checkingInDB (can fetch 1 epoch ahead)
        vi.advanceTimersByTime(10);
        await Promise.resolve();

        const step2 = stateTransitions[4];
        expect(typeof step2 === 'object' && 'epochProcessing' in step2).toBe(true);
        const step2Obj = step2;
        expect(step2Obj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(step2Obj.epochProcessing.fetching.syncingCommittees).toBe('checkingInDB');

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
        vi.advanceTimersByTime(50);
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
        vi.advanceTimersByTime(50);
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
        vi.advanceTimersByTime(50);
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
            const actor = createActor(
              epochProcessorMachine.provide({
                guards: {
                  hasEpochAlreadyStarted: vi.fn(() => true),
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

            vi.advanceTimersByTime(10);
            await Promise.resolve();

            const finalState = stateTransitions[stateTransitions.length - 1];
            expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
            const finalStateObj = finalState;
            expect(finalStateObj.epochProcessing.fetching.committees).toBe('complete');

            actor.stop();
            subscription.unsubscribe();
          });
        });

        describe('when committees are not processed', () => {
          test('should go to fetching and then complete', async () => {
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

            vi.advanceTimersByTime(10);
            await Promise.resolve();

            const step2 = stateTransitions[stateTransitions.length - 1];
            expect(typeof step2 === 'object' && 'epochProcessing' in step2).toBe(true);
            const step2Obj = step2;
            expect(step2Obj.epochProcessing.fetching.committees).toBe('fetching');

            vi.advanceTimersByTime(30);
            await Promise.resolve();

            const finalState = stateTransitions[stateTransitions.length - 1];
            expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
            const finalStateObj = finalState;
            expect(finalStateObj.epochProcessing.fetching.committees).toBe('complete');

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

            vi.advanceTimersByTime(10);
            await Promise.resolve();

            const step2 = stateTransitions[stateTransitions.length - 1];
            expect(typeof step2 === 'object' && 'epochProcessing' in step2).toBe(true);
            const step2Obj = step2;
            expect(step2Obj.epochProcessing.fetching.committees).toBe('fetching');

            vi.advanceTimersByTime(50);
            await Promise.resolve();

            const finalState = stateTransitions[stateTransitions.length - 1];
            expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
            const finalStateObj = finalState;
            expect(finalStateObj.epochProcessing.fetching.committees).toBe('fetching');

            actor.stop();
            subscription.unsubscribe();
          });
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
