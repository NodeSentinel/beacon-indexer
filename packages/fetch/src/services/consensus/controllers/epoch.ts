import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { getEpochFromSlot, getOldestLookbackSlot } from '@/src/services/consensus/utils/misc.js';

export class EpochController {
  constructor(
    private readonly beaconClient: BeaconClient,
    private readonly epochStorage: EpochStorage,
  ) {}

  async getLastCreated() {
    const result = await this.epochStorage.getLastCreated();
    return result?.epoch ?? null;
  }

  async getEpochsToCreate(lastEpoch: number | null) {
    const MAX_UNPROCESSED_EPOCHS = 5;

    // Get count of unprocessed epochs
    const unprocessedCount = await this.epochStorage.getUnprocessedCount();

    // If we already have 5 or more unprocessed epochs, don't create new ones
    if (unprocessedCount >= MAX_UNPROCESSED_EPOCHS) {
      return [];
    }

    // Calculate how many epochs we need to create
    const epochsNeeded = MAX_UNPROCESSED_EPOCHS - unprocessedCount;

    // Get the starting epoch for creation
    const lookbackEpoch = getEpochFromSlot(getOldestLookbackSlot());
    const startEpoch = lastEpoch ? lastEpoch + 1 : lookbackEpoch;

    // Create array of epochs to create
    const epochsToCreate = [];
    for (let i = 0; i < epochsNeeded; i++) {
      epochsToCreate.push(startEpoch + i);
    }

    return epochsToCreate;
  }

  async createEpochs(epochsToCreate: number[]) {
    return this.epochStorage.createEpochs(epochsToCreate);
  }

  async getMinEpochToProcess() {
    return this.epochStorage.getMinEpochToProcess();
  }
}
