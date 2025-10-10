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

// Type for epoch processing state (object with epochProcessing property)
type EpochProcessingState = Extract<SnapshotFrom<any>, { epochProcessing: unknown }>;

// Mock the logging functions
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

vi.mock('@/src/xstate/multiMachineLogger.js', () => ({
  logActor: vi.fn(),
}));

// Helper function to create a test machine with custom hasEpochAlreadyStarted guard
const createTestMachine = (hasEpochStarted: boolean = false) => {
  return epochProcessorMachine.provide({
    guards: {
      hasEpochAlreadyStarted: vi.fn(() => hasEpochStarted),
    },
  });
};

vi.mock('@/src/xstate/epoch/epoch.actors.js', () => ({
  fetchAttestationsRewards: fromPromise(vi.fn(() => new Promise(() => {}))), // Never resolves
  fetchValidatorsBalances: fromPromise(vi.fn(() => new Promise(() => {}))), // Never resolves
  fetchCommittees: fromPromise(vi.fn(() => new Promise(() => {}))), // Never resolves
  fetchSyncCommittees: fromPromise(vi.fn(() => new Promise(() => {}))), // Never resolves
  checkSyncCommitteeForEpochInDB: fromPromise(vi.fn(() => Promise.resolve({ isFetched: false }))), // Returns false - not in DB
  updateSlotsFetched: fromPromise(vi.fn(() => new Promise(() => {}))), // Never resolves
  updateSyncCommitteesFetched: fromPromise(vi.fn(() => new Promise(() => {}))), // Never resolves
  trackingTransitioningValidators: fromPromise(vi.fn(() => new Promise(() => {}))), // Never resolves
  markEpochAsProcessed: fromPromise(vi.fn()),
}));

// Mock the slotOrchestratorMachine as a proper XState v5 machine
vi.mock('@/src/xstate/slot/slotOrchestrator.machine.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setup } = require('xstate');

  const mockMachine = setup({
    types: {} as {
      context: any;
      events: any;
      input: any;
    },
  }).createMachine({
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

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

describe('epochProcessorMachine', () => {
  // describe('checkingCanProcess:waiting', () => {
  //   test('if can not process, should go to waiting and then retry', async () => {
  //     const SLOT_DURATION = ms('10ms');
  //     const SLOTS_PER_EPOCH = 32;

  //     // Create actor with conditions to go to waiting
  //     const mockBeaconTime = new BeaconTime({
  //       genesisTimestamp: 1606824000000,
  //       slotDurationMs: SLOT_DURATION,
  //       slotsPerEpoch: SLOTS_PER_EPOCH,
  //       epochsPerSyncCommitteePeriod: 256,
  //       slotStartIndexing: 32,
  //     });

  //     // Mock time for currentEpoch < 99 (canProcessEpoch = false)
  //     // We're at epoch 97, so canProcessEpoch will be false for epoch 100
  //     const EPOCH_97_START_TIME = mockBeaconTime.getTimestampFromEpochNumber(97);
  //     const mockCurrentTime = EPOCH_97_START_TIME + 50; // 50ms into epoch 97
  //     vi.useFakeTimers();
  //     vi.setSystemTime(new Date(mockCurrentTime));

  //     const actor = createActor(createTestMachine(false), {
  //       input: {
  //         epoch: 100,
  //         epochDBSnapshot: {
  //           validatorsBalancesFetched: false,
  //           rewardsFetched: false,
  //           committeesFetched: false,
  //           slotsFetched: false,
  //           syncCommitteesFetched: false,
  //           validatorsActivationFetched: false,
  //         },
  //         config: {
  //           slotDuration: SLOT_DURATION,
  //           lookbackSlot: 32,
  //         },
  //         services: {
  //           beaconTime: mockBeaconTime,
  //           epochController: mockEpochController,
  //         },
  //       },
  //     });

  //     actor.start();

  //     // Wait for the complete sequence:
  //     // checkingCanProcess -> waiting (after 0ms delay)
  //     // waiting -> checkingCanProcess (after slotDurationHalf delay = 5ms)
  //     // checkingCanProcess -> waiting (after 0ms delay)
  //     // Flush immediate transitions and scheduled delays
  //     vi.runOnlyPendingTimers();
  //     await Promise.resolve();
  //     vi.advanceTimersByTime(20);
  //     await Promise.resolve();

  //     // Stop the actor
  //     actor.stop();

  //     // Clean up
  //     vi.useRealTimers();
  //   });

  //   test('when canProcess is true (1 epoch in advance), should go to epochProcessing', async () => {
  //     const SLOT_DURATION = ms('10ms');
  //     const SLOTS_PER_EPOCH = 32;

  //     // Create actor with conditions to go to epochProcessing
  //     const mockBeaconTime = new BeaconTime({
  //       genesisTimestamp: 1606824000000,
  //       slotDurationMs: SLOT_DURATION,
  //       slotsPerEpoch: SLOTS_PER_EPOCH,
  //       epochsPerSyncCommitteePeriod: 256,
  //       slotStartIndexing: 32,
  //     });

  //     // Mock time for currentEpoch >= 100 (canProcessEpoch = true)
  //     // We're at epoch 101, so canProcessEpoch will be true for epoch 100 (1 epoch in advance)
  //     const EPOCH_101_START_TIME = mockBeaconTime.getTimestampFromEpochNumber(101);
  //     const mockCurrentTime = EPOCH_101_START_TIME + 50; // 50ms into epoch 101
  //     vi.useFakeTimers();
  //     vi.setSystemTime(new Date(mockCurrentTime));

  //     const actor = createActor(createTestMachine(false), {
  //       input: {
  //         epoch: 100,
  //         epochDBSnapshot: {
  //           validatorsBalancesFetched: false,
  //           rewardsFetched: false,
  //           committeesFetched: false,
  //           slotsFetched: false,
  //           syncCommitteesFetched: false,
  //           validatorsActivationFetched: false,
  //         },
  //         config: {
  //           slotDuration: SLOT_DURATION,
  //           lookbackSlot: 32,
  //         },
  //         services: {
  //           beaconTime: mockBeaconTime,
  //           epochController: mockEpochController,
  //         },
  //       },
  //     });

  //     actor.start();

  //     // Flush immediate transitions
  //     vi.runOnlyPendingTimers();
  //     await Promise.resolve();
  //     vi.advanceTimersByTime(10);
  //     await Promise.resolve();

  //     // Stop the actor
  //     actor.stop();

  //     // Clean up
  //     vi.useRealTimers();
  //   });
  // });

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
      });

      afterEach(() => {
        vi.useRealTimers();
        vi.clearAllTimers();
      });

      test('committees can start fetching (1 epoch ahead)', async () => {
        const actor = createActor(createTestMachine(false), {
          input: {
            epoch: 100,
            epochDBSnapshot: {
              validatorsBalancesFetched: false,
              rewardsFetched: false,
              committeesFetched: false,
              slotsFetched: false,
              syncCommitteesFetched: false,
              validatorsActivationFetched: false,
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
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateTransitions: SnapshotFrom<any>[] = [];
        const subscription = actor.subscribe((snapshot) => {
          stateTransitions.push(snapshot.value);
        });

        actor.start();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        // Machine starts by checking if we can process the epoch
        expect(stateTransitions[0]).toBe('checkingCanProcess');

        // Epoch has not started yet, committees should be in checkingIfAlreadyProcessed
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
        const step1Obj = step1 as EpochProcessingState;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.committees).toBe('checkingIfAlreadyProcessed');

        // Wait for committees to transition to fetching (committees can fetch 1 epoch ahead)
        vi.advanceTimersByTime(10);
        await Promise.resolve();

        const step2 = stateTransitions[3];
        expect(typeof step2 === 'object' && 'epochProcessing' in step2).toBe(true);
        const step2Obj = step2 as EpochProcessingState;
        // monitoringEpochStart should still be waiting (epoch has not started)
        expect(step2Obj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        // committees should now be fetching (can fetch 1 epoch ahead)
        expect(step2Obj.epochProcessing.fetching.committees).toBe('fetching');

        // Clean up
        actor.stop();
        subscription.unsubscribe();
      });

      test('syncCommittees can start fetching (1 epoch ahead)', async () => {
        const actor = createActor(createTestMachine(false), {
          input: {
            epoch: 100,
            epochDBSnapshot: {
              validatorsBalancesFetched: false,
              rewardsFetched: false,
              committeesFetched: false,
              slotsFetched: false,
              syncCommitteesFetched: false,
              validatorsActivationFetched: false,
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
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateTransitions: SnapshotFrom<any>[] = [];
        const subscription = actor.subscribe((snapshot) => {
          stateTransitions.push(snapshot.value);
        });

        actor.start();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        // Machine starts by checking if we can process the epoch
        expect(stateTransitions[0]).toBe('checkingCanProcess');

        // Epoch has not started yet
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
        const step1Obj = step1 as EpochProcessingState;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.syncingCommittees).toBe(
          'checkingIfAlreadyProcessed',
        );

        // Wait for syncCommittees to transition to checkingInDB (can fetch 1 epoch ahead)
        vi.advanceTimersByTime(10);
        await Promise.resolve();

        const step2 = stateTransitions[4];
        expect(typeof step2 === 'object' && 'epochProcessing' in step2).toBe(true);
        const step2Obj = step2 as EpochProcessingState;
        expect(step2Obj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(step2Obj.epochProcessing.fetching.syncingCommittees).toBe('checkingInDB');

        // Clean up
        actor.stop();
        subscription.unsubscribe();
      });

      test('slotsProcessing cannot start (waits for prerequisites)', async () => {
        const actor = createActor(createTestMachine(false), {
          input: {
            epoch: 100,
            epochDBSnapshot: {
              validatorsBalancesFetched: false,
              rewardsFetched: false,
              committeesFetched: false,
              slotsFetched: false,
              syncCommitteesFetched: false,
              validatorsActivationFetched: false,
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
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateTransitions: SnapshotFrom<any>[] = [];
        const subscription = actor.subscribe((snapshot) => {
          stateTransitions.push(snapshot.value);
        });

        actor.start();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        // Machine starts by checking if we can process the epoch
        expect(stateTransitions[0]).toBe('checkingCanProcess');

        // Epoch has not started yet, slotsProcessing should be waiting for prerequisites
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);
        const step1Obj = step1 as EpochProcessingState;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.slotsProcessing).toBe('waitingForPrerequisites');

        // Wait a bit to ensure it doesn't change (epoch should not start)
        vi.advanceTimersByTime(50);
        await Promise.resolve();

        const finalState = stateTransitions[stateTransitions.length - 1];
        expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
        const finalStateObj = finalState as EpochProcessingState;
        expect(finalStateObj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(finalStateObj.epochProcessing.fetching.slotsProcessing).toBe(
          'waitingForPrerequisites',
        );

        // Clean up
        actor.stop();
        subscription.unsubscribe();
      });

      test('trackingValidatorsActivation cannot start (waits for epoch start)', async () => {
        const actor = createActor(createTestMachine(false), {
          input: {
            epoch: 100,
            epochDBSnapshot: {
              validatorsBalancesFetched: false,
              rewardsFetched: false,
              committeesFetched: false,
              slotsFetched: false,
              syncCommitteesFetched: false,
              validatorsActivationFetched: false,
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
        });

        const stateTransitions: SnapshotFrom<any>[] = [];
        const subscription = actor.subscribe((snapshot) => {
          stateTransitions.push(snapshot.value);
        });

        actor.start();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        // Machine starts by checking if we can process the epoch
        expect(stateTransitions[0]).toBe('checkingCanProcess');

        // Epoch has not started yet, trackingValidatorsActivation should be waiting for epoch start
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);

        const step1Obj = step1 as EpochProcessingState;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.trackingValidatorsActivation).toBe(
          'waitingForEpochStart',
        );

        // Wait a bit to ensure it doesn't change (epoch should not start)
        vi.advanceTimersByTime(50);
        await Promise.resolve();

        const finalState = stateTransitions[stateTransitions.length - 1];
        expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
        const finalStateObj = finalState as EpochProcessingState;
        expect(finalStateObj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(finalStateObj.epochProcessing.fetching.trackingValidatorsActivation).toBe(
          'waitingForEpochStart',
        );

        // Clean up
        actor.stop();
        subscription.unsubscribe();
      });

      test('validatorsBalances cannot start (waits for epoch start)', async () => {
        const actor = createActor(createTestMachine(false), {
          input: {
            epoch: 100,
            epochDBSnapshot: {
              validatorsBalancesFetched: false,
              rewardsFetched: false,
              committeesFetched: false,
              slotsFetched: false,
              syncCommitteesFetched: false,
              validatorsActivationFetched: false,
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
        });

        const stateTransitions: SnapshotFrom<any>[] = [];
        const subscription = actor.subscribe((snapshot) => {
          stateTransitions.push(snapshot.value);
        });

        actor.start();
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        // Machine starts by checking if we can process the epoch
        expect(stateTransitions[0]).toBe('checkingCanProcess');

        // Epoch has not started yet, validatorsBalances should be in checkingIfAlreadyProcessed
        const step1 = stateTransitions[1];
        expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);

        const step1Obj = step1 as EpochProcessingState;
        expect(step1Obj.epochProcessing.monitoringEpochStart).toBe('checkingEpochStart');
        expect(step1Obj.epochProcessing.fetching.validatorsBalances).toBe('waitingForEpochStart');

        // Wait a bit to ensure it doesn't change (epoch should not start due to mock)
        vi.advanceTimersByTime(50);
        await Promise.resolve();

        const finalState = stateTransitions[stateTransitions.length - 1];
        expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
        const finalStateObj = finalState as EpochProcessingState;
        expect(finalStateObj.epochProcessing.monitoringEpochStart).not.toBe('epochStarted');
        expect(finalStateObj.epochProcessing.fetching.validatorsBalances).toBe(
          'waitingForEpochStart',
        );

        // Clean up
        actor.stop();
        subscription.unsubscribe();
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
