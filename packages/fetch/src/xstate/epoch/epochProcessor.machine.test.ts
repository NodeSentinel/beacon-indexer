import ms from 'ms';
import { test, expect, vi, beforeEach } from 'vitest';
import { createActor, createMachine, assign, ActorRefFrom, fromPromise } from 'xstate';

import { BeaconTime } from '../../services/consensus/utils/time.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';

// Mock EpochController
const mockEpochController = {
  markEpochAsProcessed: vi.fn().mockResolvedValue(undefined),
} as unknown as EpochController;

// Mock the logging functions
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

vi.mock('@/src/xstate/multiMachineLogger.js', () => ({
  logActor: vi.fn(),
}));

// Mock all the actor functions to avoid database and network calls
vi.mock('@/src/xstate/epoch/epoch.actors.js', () => ({
  fetchAttestationsRewards: vi.fn(() => Promise.resolve()),
  fetchValidatorsBalances: vi.fn(() => Promise.resolve()),
  fetchCommittees: vi.fn(() => Promise.resolve()),
  fetchSyncCommittees: vi.fn(() => Promise.resolve()),
  checkSyncCommitteeForEpochInDB: vi.fn(() => Promise.resolve({ isFetched: true })),
  updateSlotsFetched: vi.fn(() => Promise.resolve({ success: true })),
  updateSyncCommitteesFetched: vi.fn(() => Promise.resolve({ success: true })),
  trackingTransitioningValidators: vi.fn(() =>
    Promise.resolve({ success: true, processedCount: 0 }),
  ),
  markEpochAsProcessed: vi.fn(),
}));

// Mock the slotOrchestratorMachine as a proper XState machine
vi.mock('@/src/xstate/slot/slotOrchestrator.machine.js', () => {
  const mockMachine = createMachine({
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

// Import the machine after mocks are set up
// eslint-disable-next-line import/order
import { epochProcessorMachine, type EpochProcessorMachine } from './epochProcessor.machine.js';

// Helper function to create a test machine with mocked guards and actors
const createTestEpochProcessorMachine = () => {
  return epochProcessorMachine.provide({
    guards: {
      canProcessEpoch: () => true,
      hasEpochAlreadyStarted: () => true,
      hasEpochEnded: () => true,
      canProcessSlots: () => true,
    },
    actors: {
      fetchValidatorsBalances: fromPromise(() => Promise.resolve()),
      fetchAttestationsRewards: fromPromise(() => Promise.resolve()),
      fetchCommittees: fromPromise(() => Promise.resolve()),
      fetchSyncCommittees: fromPromise(() => Promise.resolve()),
      checkSyncCommitteeForEpochInDB: fromPromise(() =>
        Promise.resolve({ isFetched: true as boolean }),
      ),
      updateSlotsFetched: fromPromise(() => Promise.resolve({ success: true as boolean })),
      updateSyncCommitteesFetched: fromPromise(() => Promise.resolve({ success: true as boolean })),
      trackingTransitioningValidators: fromPromise(() =>
        Promise.resolve({ success: true as boolean, processedCount: 0 }),
      ),
      markEpochAsProcessed: fromPromise(({ input }) => {
        return input.epochController.markEpochAsProcessed(input.epoch).then(() => ({
          success: true as boolean,
          machineId: input.machineId,
        }));
      }),
    },
  });
};

// Helper function to create an actor and capture state snapshots
const createActorWithSnapshots = <TInput, TContext>(machine: any, input: TInput) => {
  const snapshots: Array<{
    value: any;
    context: TContext;
    status: any;
  }> = [];

  const actor = createActor(machine, {
    input,
  });

  // Subscribe to snapshot changes to capture state transitions
  actor.subscribe((snapshot) => {
    snapshots.push({
      value: snapshot.value,
      context: snapshot.context,
      status: snapshot.status,
    });
  });

  return { actor, snapshots };
};

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

describe('epochProcessorMachine', () => {
  describe('checkingCanProcess', () => {
    test('if can not process, should go to waiting and then retry', async () => {
      const SLOT_DURATION = ms('10ms');
      const SLOTS_PER_EPOCH = 32;

      // Create actor with conditions to go to waiting
      const mockBeaconTime = new BeaconTime({
        genesisTimestamp: 1606824000000,
        slotDurationMs: SLOT_DURATION,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        epochsPerSyncCommitteePeriod: 256,
        slotStartIndexing: 32,
      });

      // Mock time for currentEpoch < 99 (canProcessEpoch = false)
      // We're at epoch 97, so canProcessEpoch will be false for epoch 100
      const EPOCH_97_START_TIME = mockBeaconTime.getTimestampFromEpochNumber(97);
      const mockCurrentTime = EPOCH_97_START_TIME + 50; // 50ms into epoch 97
      const getTimeSpy = vi.spyOn(Date.prototype, 'getTime').mockReturnValue(mockCurrentTime);

      const { actor, snapshots } = createActorWithSnapshots(epochProcessorMachine, {
        epoch: 100,
        validatorsBalancesFetched: false,
        rewardsFetched: false,
        committeesFetched: false,
        slotsFetched: false,
        syncCommitteesFetched: false,
        validatorsActivationFetched: false,
        slotDuration: SLOT_DURATION,
        lookbackSlot: 32,
        beaconTime: mockBeaconTime,
        epochController: mockEpochController,
      });

      actor.start();

      // Wait for the complete sequence:
      // checkingCanProcess -> waiting (after 0ms delay)
      // waiting -> checkingCanProcess (after slotDurationHalf delay = 5ms)
      // checkingCanProcess -> waiting (after 0ms delay)
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Stop the actor
      actor.stop();

      // Verify the retry sequence: checkingCanProcess -> waiting -> checkingCanProcess
      expect(snapshots.length).toBeGreaterThanOrEqual(3);
      expect(snapshots[0].value).toBe('checkingCanProcess');
      expect(snapshots[1].value).toBe('waiting');
      expect(snapshots[2].value).toBe('checkingCanProcess');

      // Clean up
      getTimeSpy.mockRestore();
    });

    test('when canProcess is true (1 epoch in advance), should go to epochProcessing', async () => {
      const SLOT_DURATION = ms('10ms');
      const SLOTS_PER_EPOCH = 32;

      // Create actor with conditions to go to epochProcessing
      const mockBeaconTime = new BeaconTime({
        genesisTimestamp: 1606824000000,
        slotDurationMs: SLOT_DURATION,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        epochsPerSyncCommitteePeriod: 256,
        slotStartIndexing: 32,
      });

      // Mock time for currentEpoch >= 100 (canProcessEpoch = true)
      // We're at epoch 101, so canProcessEpoch will be true for epoch 100 (1 epoch in advance)
      const EPOCH_101_START_TIME = mockBeaconTime.getTimestampFromEpochNumber(101);
      const mockCurrentTime = EPOCH_101_START_TIME + 50; // 50ms into epoch 101
      const getTimeSpy = vi.spyOn(Date.prototype, 'getTime').mockReturnValue(mockCurrentTime);

      const { actor, snapshots } = createActorWithSnapshots(epochProcessorMachine, {
        epoch: 100,
        validatorsBalancesFetched: false,
        rewardsFetched: false,
        committeesFetched: false,
        slotsFetched: false,
        syncCommitteesFetched: false,
        validatorsActivationFetched: false,
        slotDuration: SLOT_DURATION,
        lookbackSlot: 32,
        beaconTime: mockBeaconTime,
        epochController: mockEpochController,
      });

      actor.start();

      // Wait for transition
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Stop the actor
      actor.stop();

      // Verify the transition sequence: checkingCanProcess -> epochProcessing
      expect(snapshots.length).toBeGreaterThanOrEqual(2);
      expect(snapshots[0].value).toBe('checkingCanProcess');
      expect(snapshots[1].value).toHaveProperty('epochProcessing');

      // Verify epochProcessing state is properly initialized
      expect(snapshots[1].value.epochProcessing.waitingForEpochToStart).toBe('epochStarted');
      expect(snapshots[1].value.epochProcessing.fetching).toBeDefined();

      // Clean up
      getTimeSpy.mockRestore();
    });
  });

  describe('epochProcessorMachine - markEpochAsProcessed', () => {
    test('should call markEpochAsProcessed when epoch processing completes', async () => {
      const SLOT_DURATION = ms('10ms');
      const SLOTS_PER_EPOCH = 32;

      const mockBeaconTime = new BeaconTime({
        genesisTimestamp: 1606824000000,
        slotDurationMs: SLOT_DURATION,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        epochsPerSyncCommitteePeriod: 256,
        slotStartIndexing: 32,
      });

      // Mock time for currentEpoch >= 101 (canProcessEpoch = true for epoch 100)
      const EPOCH_101_START_TIME = mockBeaconTime.getTimestampFromEpochNumber(101);
      const mockCurrentTime = EPOCH_101_START_TIME + 50; // 50ms into epoch 101
      const getTimeSpy = vi.spyOn(Date.prototype, 'getTime').mockReturnValue(mockCurrentTime);

      // Create a parent machine that spawns the epoch processor as a child
      const parentMachine = createMachine({
        id: 'parent',
        initial: 'waitingForEpochProcessing',
        types: {
          context: {} as {
            epochActor: ActorRefFrom<EpochProcessorMachine> | null;
            epochCompleted: boolean;
          },
        },
        context: {
          epochActor: null,
          epochCompleted: false,
        },
        states: {
          waitingForEpochProcessing: {
            entry: assign({
              epochActor: ({ spawn }) => {
                const testMachine = createTestEpochProcessorMachine();
                return spawn(testMachine, {
                  id: 'epochProcessor:100',
                  input: {
                    epoch: 100,
                    validatorsBalancesFetched: false, // Set to false to trigger the flow
                    rewardsFetched: false, // Set to false to trigger the flow
                    committeesFetched: true, // Keep true to skip committees
                    slotsFetched: true, // Keep true to skip slots
                    syncCommitteesFetched: true, // Keep true to skip sync committees
                    validatorsActivationFetched: true, // Keep true to skip validators activation
                    slotDuration: SLOT_DURATION,
                    lookbackSlot: 32,
                    beaconTime: mockBeaconTime,
                    epochController: mockEpochController,
                  },
                });
              },
            }),
            on: {
              EPOCH_COMPLETED: {
                actions: assign({
                  epochCompleted: true,
                }),
              },
            },
          },
        },
      });

      const { actor: parentActor, snapshots } = createActorWithSnapshots(parentMachine, {});

      // Start the parent actor (which will spawn the epoch processor as a child)
      parentActor.start();

      // Wait for the complete flow to reach completion
      // We expect some errors about parent communication, but the core logic should work
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop the actors
      parentActor.stop();

      // Verify that markEpochAsProcessed was called
      expect(vi.mocked(mockEpochController.markEpochAsProcessed)).toHaveBeenCalledWith(100);

      // Verify that the parent received the EPOCH_COMPLETED event
      const finalSnapshot = snapshots[snapshots.length - 1];
      expect((finalSnapshot.context as { epochCompleted: boolean }).epochCompleted).toBe(true);

      // Clean up
      getTimeSpy.mockRestore();
    });
  });
});
