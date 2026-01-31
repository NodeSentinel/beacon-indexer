import { VALIDATOR_STATUS } from '@beacon-indexer/consensus-utils';

import type {
  ValidatorDetails,
  ValidatorInfo,
  PerformanceSummary,
  Epoch,
  Slot,
  Attestation,
} from '@/routers/validator/schemas.js';
import { ValidatorStorage } from '@/storage/validator.js';
import { beaconTime, chainConfig } from '@/utils/beaconTime.js';
import { convertRewardToGWei, formatBalance } from '@/utils/tokenFormat.js';

/** Reverse map: numeric status id → Beacon API string */
const STATUS_BY_ID: Record<number, string> = Object.fromEntries(
  Object.entries(VALIDATOR_STATUS).map(([k, v]) => [v, k]),
);

/**
 * ValidatorController - Business logic layer for validator operations
 * Orchestrates data retrieval and transforms flat DB rows into hierarchical structure
 */
export class ValidatorController {
  constructor(private readonly storage: ValidatorStorage = new ValidatorStorage()) {}

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
    const [validatorInfoRow, performanceSummaryRow, slotRows, epochRewardsRows] = await Promise.all(
      [
        this.storage.getValidatorInfo(validatorIndex),
        this.storage.getPerformanceSummary(validatorIndex, chainConfig.beacon.maxAttestationDelay),
        this.storage.getTimelineSlots(validatorIndex),
        this.storage.getEpochRewards(validatorIndex),
      ],
    );

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
      balance: formatBalance(validatorInfoRow.balance),
      effectiveBalance: validatorInfoRow.effective_balance
        ? formatBalance(validatorInfoRow.effective_balance)
        : null,
    };

    // Transform performance summary
    const performanceSummary: PerformanceSummary = {
      attestationsTotal: performanceSummaryRow.attestations_total,
      attestationsMissed: performanceSummaryRow.attestations_missed,
      performancePercentage: Number(performanceSummaryRow.performance),
      maxAttestationDelay: chainConfig.beacon.maxAttestationDelay,
    };

    // Group slots by epoch and transform
    const epochsMap = new Map<number, Epoch>();

    // Initialize epochs from epoch_rewards
    // Rewards are stored in mGNO for Gnosis or GWei for Ethereum
    // Convert to GWei for consistent output
    for (const epochReward of epochRewardsRows) {
      epochsMap.set(epochReward.epoch, {
        epoch: epochReward.epoch,
        rewards: {
          // All rewards converted to GWei (mGNO -> GWei for Gnosis, already GWei for Ethereum)
          head: convertRewardToGWei(epochReward.head),
          target: convertRewardToGWei(epochReward.target),
          source: convertRewardToGWei(epochReward.source),
          inactivity: convertRewardToGWei(epochReward.inactivity),
          missedHead: convertRewardToGWei(epochReward.missed_head),
          missedTarget: convertRewardToGWei(epochReward.missed_target),
          missedSource: convertRewardToGWei(epochReward.missed_source),
          missedInactivity: convertRewardToGWei(epochReward.missed_inactivity),
        },
        slot: null,
      });
    }

    // Group slots by epoch
    // A validator attests only once per epoch, so we assign a single slot per epoch
    for (const slotRow of slotRows) {
      const epoch = beaconTime.getEpochFromSlot(slotRow.slot);

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
      performanceSummary,
      epochs,
    };
  }
}
