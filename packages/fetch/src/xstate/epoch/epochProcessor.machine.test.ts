import ms from 'ms';
import { test, expect, vi, beforeEach } from 'vitest';
import {
  createActor,
  createMachine,
  assign,
  ActorRefFrom,
  fromPromise,
  SnapshotFrom,
  setup,
} from 'xstate';

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
// vi.mock('@/src/xstate/slot/slotOrchestrator.machine.js', () => {
//   const mockMachine = setup({
//     types: {} as {
//       context: {
//         epoch: number;
//         startSlot: number;
//         endSlot: number;
//         currentSlot: number;
//         slotActor: any;
//         lookbackSlot: number;
//         slotDuration: number;
//       };
//       events: any;
//       input: {
//         epoch: number;
//         lookbackSlot: number;
//         slotDuration: number;
//       };
//     },
//   }).createMachine({
//     id: 'mockSlotOrchestrator',
//     initial: 'idle',
//     context: ({ input }) => ({
//       epoch: input.epoch,
//       startSlot: input.epoch * 32,
//       endSlot: (input.epoch + 1) * 32 - 1,
//       currentSlot: input.epoch * 32,
//       slotActor: null,
//       lookbackSlot: input.lookbackSlot,
//       slotDuration: input.slotDuration,
//     }),
//     states: {
//       idle: {
//         type: 'final',
//       },
//     },
//   });

//   return {
//     slotOrchestratorMachine: mockMachine,
//   };
// });

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

describe('epochProcessorMachine', () => {
  // describe('checkingCanProcess, waiting and retry', () => {
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

  //     const actor = createActor(epochProcessorMachine, {
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

  //     const actor = createActor(epochProcessorMachine, {
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

  describe('epochProcessing.waitingForEpochToStart', () => {
    test('should initiate fetching states', async () => {
      const SLOT_DURATION = ms('10ms');
      const SLOTS_PER_EPOCH = 32;

      const mockBeaconTime = new BeaconTime({
        genesisTimestamp: 1606824000000,
        slotDurationMs: SLOT_DURATION,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        epochsPerSyncCommitteePeriod: 256,
        slotStartIndexing: 32,
      });

      // Mock time to advance dynamically through the test
      const EPOCH_100_START_SLOT = mockBeaconTime.getEpochSlots(100).startSlot;
      const EPOCH_100_START_TIME = mockBeaconTime.getTimestampFromSlotNumber(EPOCH_100_START_SLOT);
      let currentTime = EPOCH_100_START_TIME - 50; // Start 50ms before epoch 100 starts

      // Use fake timers to control time-based transitions
      vi.useFakeTimers();
      vi.setSystemTime(new Date(currentTime));

      const actor = createActor(epochProcessorMachine, {
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

      // Machine starts by checking if we can process the epoch
      expect(stateTransitions[0]).toBe('checkingCanProcess');

      // Epoch has not started yet
      const step1 = stateTransitions[1];
      expect(typeof step1 === 'object' && 'epochProcessing' in step1).toBe(true);

      const step1Obj = step1 as EpochProcessingState;
      expect(step1Obj.epochProcessing.waitingForEpochToStart).toBe('checkingEpochStatus');
      // Committees and syncingCommittees can fetch 1 epoch ahead
      expect(step1Obj.epochProcessing.fetching.committees).toBe('checkingEpochStatus');
      expect(step1Obj.epochProcessing.fetching.syncingCommittees).toBe('checkingEpochStatus');
      // Slots waits for prerequisites (committees + epoch start)
      expect(step1Obj.epochProcessing.fetching.slotsProcessing).toBe('waitingForPrerequisites');
      // Other states wait for epoch start
      expect(step1Obj.epochProcessing.fetching.trackingValidatorsActivation).toBe(
        'waitingForEpochStart',
      );
      expect(step1Obj.epochProcessing.fetching.validatorsBalances).toBe('checkingStatus');
      expect(step1Obj.epochProcessing.fetching.rewards).toBe('waitingForValidatorsBalances');

      // STEP 2: Wait for committees to start fetching (they can fetch 1 epoch ahead)
      vi.advanceTimersByTime(20); // Give committees time to transition
      await Promise.resolve();

      const step2 = stateTransitions[2];
      console.log('Step 2:', JSON.stringify(step2, null, 2));
      expect(typeof step2 === 'object' && 'epochProcessing' in step2).toBe(true);
      const step2Obj = step2 as EpochProcessingState;
      expect(step2Obj.epochProcessing.waitingForEpochToStart).toBe('waiting');

      // Committees and syncingCommittees are still checking epoch status
      expect(step2Obj.epochProcessing.fetching.committees).toBe('checkingEpochStatus');
      expect(step2Obj.epochProcessing.fetching.syncingCommittees).toBe('checkingEpochStatus');
      expect(step2Obj.epochProcessing.fetching.slotsProcessing).toBe('waitingForPrerequisites');
      expect(step2Obj.epochProcessing.fetching.trackingValidatorsActivation).toBe(
        'waitingForEpochStart',
      );
      expect(step2Obj.epochProcessing.fetching.validatorsBalances).toBe('checkingStatus');
      expect(step2Obj.epochProcessing.fetching.rewards).toBe('waitingForValidatorsBalances');

      // STEP 3: Wait for committees to transition to fetching
      vi.advanceTimersByTime(30); // Give committees more time to transition
      await Promise.resolve();

      const step3 = stateTransitions[3];
      console.log('Step 3:', JSON.stringify(step3, null, 2));
      expect(typeof step3 === 'object' && 'epochProcessing' in step3).toBe(true);
      const step3Obj = step3 as EpochProcessingState;
      expect(step3Obj.epochProcessing.waitingForEpochToStart).toBe('waiting');

      // Committees should now be fetching, syncingCommittees still checking epoch status
      expect(step3Obj.epochProcessing.fetching.committees).toBe('fetching');
      expect(step3Obj.epochProcessing.fetching.syncingCommittees).toBe('checkingEpochStatus');
      expect(step3Obj.epochProcessing.fetching.slotsProcessing).toBe('waitingForPrerequisites');
      expect(step3Obj.epochProcessing.fetching.trackingValidatorsActivation).toBe(
        'waitingForEpochStart',
      );
      expect(step3Obj.epochProcessing.fetching.validatorsBalances).toBe('checkingStatus');
      expect(step3Obj.epochProcessing.fetching.rewards).toBe('waitingForValidatorsBalances');

      // STEP 4: Wait for syncingCommittees to transition to checkingInDB and then updating
      vi.advanceTimersByTime(20); // Give syncingCommittees time to transition
      await Promise.resolve();

      const step4 = stateTransitions[4];
      console.log('Step 4:', JSON.stringify(step4, null, 2));
      expect(typeof step4 === 'object' && 'epochProcessing' in step4).toBe(true);
      const step4Obj = step4 as EpochProcessingState;
      expect(step4Obj.epochProcessing.waitingForEpochToStart).toBe('waiting');

      // SyncingCommittees should now be checking in DB (since it's not in DB)
      expect(step4Obj.epochProcessing.fetching.committees).toBe('fetching');
      expect(step4Obj.epochProcessing.fetching.syncingCommittees).toBe('checkingInDB');
      expect(step4Obj.epochProcessing.fetching.slotsProcessing).toBe('waitingForPrerequisites');
      expect(step4Obj.epochProcessing.fetching.trackingValidatorsActivation).toBe(
        'waitingForEpochStart',
      );
      expect(step4Obj.epochProcessing.fetching.validatorsBalances).toBe('checkingStatus');
      expect(step4Obj.epochProcessing.fetching.rewards).toBe('waitingForValidatorsBalances');

      // STEP 5: Wait for syncingCommittees to transition to fetching
      vi.advanceTimersByTime(20); // Give syncingCommittees time to transition
      await Promise.resolve();

      const step5 = stateTransitions[5];
      console.log('Step 5:', JSON.stringify(step5, null, 2));
      expect(typeof step5 === 'object' && 'epochProcessing' in step5).toBe(true);
      const step5Obj = step5 as EpochProcessingState;
      expect(step5Obj.epochProcessing.waitingForEpochToStart).toBe('waiting');

      // SyncingCommittees should still be checking in DB (invoke not completed yet)
      expect(step5Obj.epochProcessing.fetching.committees).toBe('fetching');
      expect(step5Obj.epochProcessing.fetching.syncingCommittees).toBe('checkingInDB');
      expect(step5Obj.epochProcessing.fetching.slotsProcessing).toBe('waitingForPrerequisites');
      expect(step5Obj.epochProcessing.fetching.trackingValidatorsActivation).toBe(
        'waitingForEpochStart',
      );
      expect(step5Obj.epochProcessing.fetching.validatorsBalances).toBe('fetching');
      expect(step5Obj.epochProcessing.fetching.rewards).toBe('waitingForValidatorsBalances');

      // STEP 6: Now advance time to epoch start
      currentTime = EPOCH_100_START_TIME + 10; // 10ms after epoch 100 starts
      vi.setSystemTime(new Date(currentTime));
      vi.advanceTimersByTime(10); // Process epoch start
      await Promise.resolve();

      // STEP 5: Epoch started - all fetching states should be in fetching (except rewards which waits on validatorsBalances)
      const finalState = stateTransitions[stateTransitions.length - 1];
      expect(typeof finalState === 'object' && 'epochProcessing' in finalState).toBe(true);
      const finalStateObj = finalState as EpochProcessingState;

      console.log('Final state:', JSON.stringify(finalStateObj, null, 2));

      // waitingForEpochToStart should emit EPOCH_STARTED
      expect(finalStateObj.epochProcessing.waitingForEpochToStart).toBe('epochStarted');

      // All fetching states should be in fetching (except rewards which waits on validatorsBalances)
      expect(finalStateObj.epochProcessing.fetching.committees).toBe('fetching');
      expect(finalStateObj.epochProcessing.fetching.syncingCommittees).toBe('fetching');
      expect(finalStateObj.epochProcessing.fetching.slotsProcessing).toBe(
        'waitingForPrerequisites',
      );
      expect(finalStateObj.epochProcessing.fetching.trackingValidatorsActivation).toBe('fetching');
      expect(finalStateObj.epochProcessing.fetching.validatorsBalances).toBe('fetching');
      // Rewards should still be waiting for validatorsBalances to complete
      expect(finalStateObj.epochProcessing.fetching.rewards).toBe('waitingForValidatorsBalances');

      // Clean up
      subscription.unsubscribe();
      actor.stop();

      // Clean up
      vi.useRealTimers();
    });
  });

  // describe('state.epochCompleted', () => {
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
