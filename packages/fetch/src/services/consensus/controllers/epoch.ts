import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';

export const MAX_UNPROCESSED_EPOCHS = 5;
export class EpochController {
  constructor(
    private readonly beaconClient: BeaconClient,
    private readonly epochStorage: EpochStorage,
  ) {}

  async getMaxEpoch() {
    const result = await this.epochStorage.getMaxEpoch();
    return result?.epoch ?? null;
  }

  async getMinEpochToProcess() {
    return this.epochStorage.getMinEpochToProcess();
  }

  async getUnprocessedCount() {
    return this.epochStorage.getUnprocessedCount();
  }

  async markEpochAsProcessed(epoch: number) {
    await this.epochStorage.markEpochAsProcessed(epoch);
  }

  async getAllEpochs() {
    return this.epochStorage.getAllEpochs();
  }

  async getEpochCount() {
    return this.epochStorage.getEpochCount();
  }

  private async getEpochsToCreate(lastEpoch: number | null) {
    // Get count of unprocessed epochs
    const unprocessedCount = await this.epochStorage.getUnprocessedCount();

    // If we already have 5 or more unprocessed epochs, don't create new ones
    if (unprocessedCount >= MAX_UNPROCESSED_EPOCHS) {
      return [];
    }

    // Calculate how many epochs we need to create
    const epochsNeeded = MAX_UNPROCESSED_EPOCHS - unprocessedCount;

    // Get the starting epoch for creation using slotStartIndexing from BeaconClient
    const startEpoch = lastEpoch
      ? lastEpoch + 1
      : Math.floor(this.beaconClient.slotStartIndexing / 32);

    // Create array of epochs to create
    const epochsToCreate = [];
    for (let i = 0; i < epochsNeeded; i++) {
      epochsToCreate.push(startEpoch + i);
    }

    return epochsToCreate;
  }

  // New method that handles the complete epoch creation logic internally
  async createEpochsIfNeeded() {
    try {
      // Get the last created epoch
      const lastEpoch = await this.getMaxEpoch();

      // Get epochs to create based on the last epoch
      const epochsToCreate = await this.getEpochsToCreate(lastEpoch);

      // If there are epochs to create, create them
      if (epochsToCreate.length > 0) {
        await this.epochStorage.createEpochs(epochsToCreate);
      }
    } catch (error) {
      // Log error but don't throw to prevent machine from stopping
      console.error('Error in createEpochsIfNeeded:', error);
    }
  }
}
