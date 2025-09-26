import { test, expect } from 'vitest';
import { createActor } from 'xstate';

import { epochCreationMachine } from './epochCreator.machine.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';

// Type for mock EpochController with only the methods we need
type MockEpochController = {
  getLastCreated: () => Promise<number | null>;
  getEpochsToCreate: () => Promise<number[]>;
  createEpochs: () => Promise<void>;
  getMinEpochToProcess: () => Promise<unknown>;
};

describe('epochCreationMachine', () => {
  test('should initialize with correct context and transition to readLastCreated', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async getLastCreated() {
        return 100;
      },
      async getEpochsToCreate() {
        return [101, 102, 103];
      },
      async createEpochs() {
        return;
      },
      async getMinEpochToProcess() {
        return null;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: 1,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Act
    actor.start();

    // Assert
    const snapshot = actor.getSnapshot();

    // Check that context is properly initialized
    expect(snapshot.context.lastEpoch).toBe(0);
    expect(snapshot.context.epochsToCreate).toEqual([]);

    // The machine should automatically transition to 'readLastCreated' due to the 'always' transition
    expect(snapshot.value).toBe('readLastCreated');

    // Clean up
    actor.stop();
  });

  test('should successfully complete full workflow and reach sleep state', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async getLastCreated() {
        return 150;
      },
      async getEpochsToCreate() {
        return [151, 152, 153];
      },
      async createEpochs() {
        return;
      },
      async getMinEpochToProcess() {
        return null;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: 1,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Act
    actor.start();

    // Wait for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert - The machine should have completed the full workflow and be in sleep
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('sleep');
    expect(snapshot.context.lastEpoch).toBe(150);
    expect(snapshot.context.epochsToCreate).toEqual([151, 152, 153]);

    // Clean up
    actor.stop();
  });

  test('should handle readLastCreated error and transition to sleep', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async getLastCreated() {
        throw new Error('Database connection failed');
      },
      async getEpochsToCreate() {
        return [101, 102, 103];
      },
      async createEpochs() {
        return;
      },
      async getMinEpochToProcess() {
        return null;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: 1,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Act
    actor.start();

    // Wait for the async operation to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Assert
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('sleep');
    // Context should remain unchanged on error
    expect(snapshot.context.lastEpoch).toBe(0);

    // Clean up
    actor.stop();
  });

  test('should successfully transition from getEpochsToCreate to createEpochs', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async getLastCreated() {
        return 200;
      },
      async getEpochsToCreate() {
        return [201, 202, 203, 204];
      },
      async createEpochs() {
        return;
      },
      async getMinEpochToProcess() {
        return null;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: 1,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Act
    actor.start();

    // Wait for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert - The machine completes the full workflow and ends in sleep
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('sleep');
    expect(snapshot.context.lastEpoch).toBe(200);
    expect(snapshot.context.epochsToCreate).toEqual([201, 202, 203, 204]);

    // Clean up
    actor.stop();
  });

  test('should handle getEpochsToCreate error and transition to sleep', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async getLastCreated() {
        return 300;
      },
      async getEpochsToCreate() {
        throw new Error('Failed to compute epochs');
      },
      async createEpochs() {
        return;
      },
      async getMinEpochToProcess() {
        return null;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: 1,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Act
    actor.start();

    // Wait for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Assert
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('sleep');
    expect(snapshot.context.lastEpoch).toBe(300);
    // epochsToCreate should remain empty on error
    expect(snapshot.context.epochsToCreate).toEqual([]);

    // Clean up
    actor.stop();
  });

  test('should successfully transition from createEpochs to sleep', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async getLastCreated() {
        return 400;
      },
      async getEpochsToCreate() {
        return [401, 402];
      },
      async createEpochs() {
        return;
      },
      async getMinEpochToProcess() {
        return null;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: 1,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Act
    actor.start();

    // Wait for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Assert
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('sleep');
    expect(snapshot.context.lastEpoch).toBe(400);
    expect(snapshot.context.epochsToCreate).toEqual([401, 402]);

    // Clean up
    actor.stop();
  });

  test('should handle createEpochs error and transition to sleep', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async getLastCreated() {
        return 500;
      },
      async getEpochsToCreate() {
        return [501, 502, 503];
      },
      async createEpochs() {
        throw new Error('Failed to enqueue epochs');
      },
      async getMinEpochToProcess() {
        return null;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: 1,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Act
    actor.start();

    // Wait for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Assert
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('sleep');
    expect(snapshot.context.lastEpoch).toBe(500);
    expect(snapshot.context.epochsToCreate).toEqual([501, 502, 503]);

    // Clean up
    actor.stop();
  });

  test('should handle empty epochs list from getEpochsToCreate', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async getLastCreated() {
        return 600;
      },
      async getEpochsToCreate() {
        return []; // Empty array
      },
      async createEpochs() {
        return;
      },
      async getMinEpochToProcess() {
        return null;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: 1,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Act
    actor.start();

    // Wait for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Assert
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('sleep');
    expect(snapshot.context.lastEpoch).toBe(600);
    expect(snapshot.context.epochsToCreate).toEqual([]);

    // Clean up
    actor.stop();
  });

  test('should handle null lastEpoch from getLastCreatedEpoch', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async getLastCreated() {
        return null; // No previous epoch
      },
      async getEpochsToCreate() {
        return [1, 2, 3];
      },
      async createEpochs() {
        return;
      },
      async getMinEpochToProcess() {
        return null;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: 1,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Act
    actor.start();

    // Wait for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Assert
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('sleep');
    expect(snapshot.context.lastEpoch).toBe(null);
    expect(snapshot.context.epochsToCreate).toEqual([1, 2, 3]);

    // Clean up
    actor.stop();
  });

  test('should complete full workflow successfully', async () => {
    // Arrange
    const mockEpochController: MockEpochController = {
      async getLastCreated() {
        return 1000;
      },
      async getEpochsToCreate() {
        return [1001, 1002, 1003, 1004, 1005];
      },
      async createEpochs() {
        return;
      },
      async getMinEpochToProcess() {
        return null;
      },
    };

    const testMachine = epochCreationMachine;
    const actor = createActor(testMachine, {
      input: {
        slotDuration: 1,
        epochController: mockEpochController as unknown as EpochController,
      },
    });

    // Act
    actor.start();

    // Wait for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('sleep');
    expect(snapshot.context.lastEpoch).toBe(1000);
    expect(snapshot.context.epochsToCreate).toEqual([1001, 1002, 1003, 1004, 1005]);

    // Clean up
    actor.stop();
  });
});
