import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';

import type {
  Attestation,
  Epoch,
  Slot,
  ValidatorDetails,
  ValidatorInfo,
} from '@/routers/validator/schemas.js';

import { ValidatorStorage } from '@/storage/validator.js';
import type { BeaconHelpers } from '@/utils/beaconTime.js';
import { formatBalance } from '@/utils/tokenFormat.js';

/** Reverse map: numeric status id → Beacon API string */
const STATUS_BY_ID: Record<number, string> = Object.fromEntries(
  Object.entries(VALIDATOR_STATUS).map(([k, v]) => [v, k]),
);

/**
 * ValidatorController - Business logic layer for validator operations
 * Orchestrates data retrieval and transforms flat DB rows into hierarchical structure
 */
export class ValidatorController {
  constructor(params: {
    beaconHelpers: BeaconHelpers;
    chain: 'ethereum' | 'gnosis';
    storage: ValidatorStorage;
  }) {
    this.storage = params.storage;
    this.beaconHelpers = params.beaconHelpers;
    this.chain = params.chain;
  }

  private readonly beaconHelpers: BeaconHelpers;
  private readonly chain: 'ethereum' | 'gnosis';
  private readonly storage: ValidatorStorage;

  /**
   * Get validator details with timeline grouped by epoch → slot
   * @param id - Validator index (number) or pubkey (string, 98 chars)
   * @returns Validator details with hierarchical epoch→slot structure
   */
  async getDetails(id: number | string): Promise<ValidatorDetails> {
    // Resolve validator index
    let validatorIndex: number;
    if (typeof id === 'string') {
      // It's a pubkey
      const resolved = await this.storage.resolveValidatorIndex(id);
      if (!resolved) {
        throw new Error(`Validator not found for pubkey: ${id}`);
      }
      validatorIndex = resolved;
    } else {
      // It's a validator index
      validatorIndex = id;
    }

    // Fetch all data in parallel (no slot/epoch filters - all data)
    const [validatorInfoRow, slotRows, epochRewardsRows] = await Promise.all([
      this.storage.getValidatorInfo(validatorIndex),
      this.storage.getTimelineSlots(validatorIndex),
      this.storage.getEpochRewards(validatorIndex),
    ]);

    if (!validatorInfoRow) {
      throw new Error(`Validator not found: ${validatorIndex}`);
    }

    // Transform validator info
    const validatorInfo: ValidatorInfo = {
      id: validatorInfoRow.id,
      pubkey: validatorInfoRow.pubkey,
      withdrawalAddress: validatorInfoRow.withdrawal_address,
      status:
        validatorInfoRow.status !== null
          ? {
              id: validatorInfoRow.status,
              value: STATUS_BY_ID[validatorInfoRow.status] ?? 'unknown',
            }
          : null,
      balance: formatBalance(validatorInfoRow.balance, this.chain),
      effectiveBalance: validatorInfoRow.effective_balance
        ? formatBalance(validatorInfoRow.effective_balance, this.chain)
        : null,
    };

    // Group slots by epoch and transform
    const epochsMap = new Map<number, Epoch>();

    // Initialize epochs from epoch_rewards
    // Rewards are stored in Gwei — use formatBalance to convert to token units
    for (const epochReward of epochRewardsRows) {
      epochsMap.set(epochReward.epoch, {
        epoch: epochReward.epoch,
        rewards: {
          head: formatBalance(epochReward.head, this.chain),
          target: formatBalance(epochReward.target, this.chain),
          source: formatBalance(epochReward.source, this.chain),
          inactivity: formatBalance(epochReward.inactivity, this.chain),
          missedHead: formatBalance(epochReward.missed_head, this.chain),
          missedTarget: formatBalance(epochReward.missed_target, this.chain),
          missedSource: formatBalance(epochReward.missed_source, this.chain),
          missedInactivity: formatBalance(epochReward.missed_inactivity, this.chain),
        },
        slot: null,
      });
    }

    // Group slots by epoch
    // A validator attests only once per epoch, so we assign a single slot per epoch
    for (const slotRow of slotRows) {
      const epoch = this.beaconHelpers.beaconTime.getEpochFromSlot(slotRow.slot);

      // Ensure epoch exists in map
      if (!epochsMap.has(epoch)) {
        epochsMap.set(epoch, {
          epoch,
          rewards: {
            head: '0',
            target: '0',
            source: '0',
            inactivity: '0',
            missedHead: '0',
            missedTarget: '0',
            missedSource: '0',
            missedInactivity: '0',
          },
          slot: null,
        });
      }

      const epochData = epochsMap.get(epoch)!;

      // If slot already exists for this epoch, skip (validator should only attest once per epoch)
      if (epochData.slot !== null) {
        continue;
      }

      // Transform slot row to slot schema
      const attestation: Attestation = {
        indexInEpoch: slotRow.index,
        aggregationBitsIndex: slotRow.aggregation_bits_index,
        delay: slotRow.attestation_delay,
      };

      const slot: Slot = {
        slot: slotRow.slot,
        attestation,
        blockRewards: {
          blockReward: slotRow.block_reward,
        },
        syncRewards: {
          syncCommittee: slotRow.sync_committee,
        },
      };

      epochData.slot = slot;
    }

    // Sort epochs descending
    const epochs = Array.from(epochsMap.values()).sort((a, b) => b.epoch - a.epoch);

    return {
      validatorInfo,
      epochs,
    };
  }
}
