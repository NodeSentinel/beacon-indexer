import { test, expect, vi, beforeEach } from 'vitest';
import { createActor, createMachine } from 'xstate';

import { BeaconTime } from '@/src/services/consensus/utils/time.js';

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
  checkSyncCommitteeForEpochInDB: vi.fn(() => Promise.resolve({ isFetched: false })),
  updateSlotsFetched: vi.fn(() => Promise.resolve()),
  updateSyncCommitteesFetched: vi.fn(() => Promise.resolve()),
  trackingTransitioningValidators: vi.fn(() => Promise.resolve()),
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

// Mock the slotOrchestratorMachine to avoid XState v5 getInitialSnapshot bug
// This is a known issue in XState v5: https://github.com/statelyai/xstate/issues/5077
// The tests pass but there are unhandled errors from XState internals
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
import { epochProcessorMachine } from './epochProcessor.machine.js';

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

describe('epochProcessorMachine', () => {
  describe('epochProcessorMachine - canProcessEpoch guard', () => {
    test('step by step: when canProcess is false, should go to waiting and retry', async () => {
      // Test constants for readability
      const GENESIS_TIMESTAMP = 1606824000000; // Example genesis timestamp
      const SLOT_DURATION_MS = 100; // 100ms per slot for fast tests
      const SLOTS_PER_EPOCH = 32;

      // Create actor with conditions to go to waiting
      const mockBeaconTime = new BeaconTime({
        genesisTimestamp: GENESIS_TIMESTAMP,
        slotDurationMs: SLOT_DURATION_MS,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        epochsPerSyncCommitteePeriod: 256,
      });

      // Mock time for currentEpoch < 99 (canProcessEpoch = false)
      // We're at epoch 97, so canProcessEpoch will be false for epoch 100
      const EPOCH_97_START_TIME = GENESIS_TIMESTAMP + 97 * SLOTS_PER_EPOCH * SLOT_DURATION_MS;
      const mockCurrentTime = EPOCH_97_START_TIME + 50; // 50ms into epoch 97
      const getTimeSpy = vi.spyOn(Date.prototype, 'getTime').mockReturnValue(mockCurrentTime);

      // Track microsteps using XState inspection API (as recommended by XState maintainer)
      const microstepValues: string[] = [];
      const actor = createActor(epochProcessorMachine, {
        input: {
          epoch: 100,
          validatorsBalancesFetched: false,
          rewardsFetched: false,
          committeesFetched: false,
          slotsFetched: false,
          syncCommitteesFetched: false,
          validatorsActivationFetched: false,
          slotDuration: 0.1, // 100ms = 0.1 seconds
          lookbackSlot: 32,
          beaconTime: mockBeaconTime,
        },
        inspect: (inspectionEvent) => {
          if (inspectionEvent.type === '@xstate.microstep') {
            // @ts-expect-error - snapshot.value exists at runtime for microstep events but not in type definition
            microstepValues.push(inspectionEvent.snapshot.value);
          }
        },
      });

      actor.start();

      // Wait for the complete sequence: checkingCanProcess -> waiting -> checkingCanProcess -> waiting
      await new Promise((resolve) => setTimeout(resolve, 100));

      // With always transitions, we need to use microsteps to capture the intermediate states
      // Verify we have the expected microsteps
      expect(microstepValues.length).toBeGreaterThanOrEqual(3);
      expect(microstepValues).toContain('checkingCanProcess');
      expect(microstepValues).toContain('waiting');

      // Verify the sequence: waiting -> checkingCanProcess -> waiting (retry sequence)
      expect(microstepValues[0]).toBe('waiting');
      expect(microstepValues[1]).toBe('checkingCanProcess');
      expect(microstepValues[2]).toBe('waiting');

      // Clean up
      actor.stop();
      getTimeSpy.mockRestore();
    });

    test('when canProcess is true, should go to epochProcessing', async () => {
      // Test constants for readability
      const GENESIS_TIMESTAMP = 1606824000000; // Example genesis timestamp
      const SLOT_DURATION_MS = 100; // 100ms per slot for fast tests
      const SLOTS_PER_EPOCH = 32;

      // Create actor with conditions to go to epochProcessing
      const mockBeaconTime = new BeaconTime({
        genesisTimestamp: GENESIS_TIMESTAMP,
        slotDurationMs: SLOT_DURATION_MS,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        epochsPerSyncCommitteePeriod: 256,
      });

      // Mock time for currentEpoch >= 99 (canProcessEpoch = true)
      // We're at epoch 99, so canProcessEpoch will be true for epoch 100
      const EPOCH_99_START_TIME = GENESIS_TIMESTAMP + 99 * SLOTS_PER_EPOCH * SLOT_DURATION_MS;
      const mockCurrentTime = EPOCH_99_START_TIME + 50; // 50ms into epoch 99
      const getTimeSpy = vi.spyOn(Date.prototype, 'getTime').mockReturnValue(mockCurrentTime);

      const actor = createActor(epochProcessorMachine, {
        input: {
          epoch: 100,
          validatorsBalancesFetched: false,
          rewardsFetched: false,
          committeesFetched: false,
          slotsFetched: false,
          syncCommitteesFetched: false,
          validatorsActivationFetched: false,
          slotDuration: 0.1, // 100ms = 0.1 seconds
          lookbackSlot: 32,
          beaconTime: mockBeaconTime,
        },
      });

      // Track state transitions
      const stateTransitions: string[] = [];
      const subscription = actor.subscribe((snapshot) => {
        stateTransitions.push(snapshot.value as string);
      });

      actor.start();

      // Wait for transition
      await new Promise((resolve) => setTimeout(resolve, 5));

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toHaveProperty('epochProcessing');
      expect(stateTransitions[0]).toHaveProperty('epochProcessing');

      // Clean up
      subscription.unsubscribe();
      actor.stop();
      getTimeSpy.mockRestore();
    });
  });
});
