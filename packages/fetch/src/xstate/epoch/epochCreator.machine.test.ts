import { test, expect } from 'vitest';
import { createActor } from 'xstate';

import { epochCreationMachine } from './epochCreator.machine.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';

// Type for mock EpochController with only the methods we need
type MockEpochController = {
  createEpochsIfNeeded: () => Promise<void>;
};

describe('epochCreationMachine', () => {
  // Use a very small slotDuration for fast tests
  const FAST_SLOT_DURATION = 0.01; // 10ms

  test('should successfully complete createEpochs and reach sleep state', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async createEpochsIfNeeded() {
        return;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: FAST_SLOT_DURATION,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Track state transitions
    const stateTransitions: string[] = [];

    // Subscribe to state changes
    actor.subscribe((snapshot) => {
      stateTransitions.push(snapshot.value as string);
    });

    // Act
    actor.start();

    // Wait for the async operation to complete
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should have transitioned to sleep
    expect(stateTransitions.length).toBeGreaterThan(1);
    expect(stateTransitions[0]).toBe('createEpochs');
    expect(stateTransitions[1]).toBe('sleep');

    // Clean up
    actor.stop();
  });

  test('should handle createEpochsIfNeeded error and transition to sleep', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async createEpochsIfNeeded() {
        throw new Error('Database connection failed');
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: FAST_SLOT_DURATION,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Track state transitions
    const stateTransitions: string[] = [];

    // Subscribe to state changes
    actor.subscribe((snapshot) => {
      stateTransitions.push(snapshot.value as string);
    });

    // Act
    actor.start();

    // Wait for the async operation to complete
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should have transitioned to sleep even on error
    expect(stateTransitions.length).toBeGreaterThan(1);
    expect(stateTransitions[0]).toBe('createEpochs');
    expect(stateTransitions[1]).toBe('sleep');

    // Clean up
    actor.stop();
  });

  test('should transition from sleep back to createEpochs after delay', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async createEpochsIfNeeded() {
        return;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: FAST_SLOT_DURATION,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Track state transitions
    const stateTransitions: string[] = [];

    // Subscribe to state changes
    actor.subscribe((snapshot) => {
      stateTransitions.push(snapshot.value as string);
    });

    // Act
    actor.start();

    // Wait for the first cycle to complete (createEpochs -> sleep)
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert - Should have gone through createEpochs -> sleep
    expect(stateTransitions.length).toBeGreaterThanOrEqual(2);
    expect(stateTransitions[0]).toBe('createEpochs');
    expect(stateTransitions[1]).toBe('sleep');

    // Wait for the delay to complete and transition back to createEpochs
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Assert - Should have transitioned back to createEpochs
    expect(stateTransitions.length).toBeGreaterThan(2);
    expect(stateTransitions[2]).toBe('createEpochs');

    // Clean up
    actor.stop();
  });
});
