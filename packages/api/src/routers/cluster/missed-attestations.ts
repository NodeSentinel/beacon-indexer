import {
  MissedAttestationsInputSchema,
  MissedAttestationsAllInputSchema,
  MissedAttestationsValidatorInputSchema,
  MissedAttestationsResponseSchema,
} from './analytics-schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { AnalyticsStorage } from '@/storage/analytics.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { beaconTime, chainConfig } from '@/utils/beaconTime.js';
import { ApiResponseSchema } from '@/utils/response.js';

const clusterStorage = new ClusterStorage();
const analyticsStorage = new AnalyticsStorage();

/**
 * Get validator indexes for a single cluster
 */
async function getValidatorIndexesForCluster(clusterId: string): Promise<number[]> {
  const cluster = await clusterStorage.findByIdWithValidators(clusterId);
  if (!cluster) {
    return [];
  }
  return cluster.validators.map((v) => v.validatorIndex);
}

/**
 * Get all deduplicated validator indexes across all clusters for an owner
 */
async function getAllValidatorIndexesForOwner(ownerId: string): Promise<number[]> {
  const clusters = await clusterStorage.listByOwner(BigInt(ownerId));
  const indexSet = new Set<number>();

  for (const cluster of clusters) {
    const clusterWithValidators = await clusterStorage.findByIdWithValidators(cluster.id);
    if (clusterWithValidators) {
      for (const v of clusterWithValidators.validators) {
        indexSet.add(v.validatorIndex);
      }
    }
  }

  return Array.from(indexSet);
}

/**
 * Fetch missed attestations for a set of validators within a time range.
 * '1h' uses the committee table (recent per-slot data).
 * '24h' uses the validator_hourly_archive table (historical hourly data).
 */
async function fetchMissedAttestations(
  validatorIndexes: number[],
  range: '1h' | '24h',
): Promise<Array<{ timestamp: string; count: number; validatorCount: number }>> {
  if (range === '1h') {
    const fromSlot = beaconTime.getSlotNumberFromTimestamp(Date.now() - 3_600_000);
    const toSlot = beaconTime.getChainCurrentSlot();
    const rows = await analyticsStorage.getMissedAttestationsFromCommittee(
      validatorIndexes,
      fromSlot,
      toSlot,
      chainConfig.beacon.slotsPerEpoch,
      chainConfig.beacon.maxAttestationDelay,
    );

    return rows.map((row) => ({
      timestamp: new Date(beaconTime.getTimestampFromEpochNumber(row.epoch)).toISOString(),
      count: Number(row.count),
      validatorCount: Number(row.validator_count),
    }));
  }

  // 24h range
  const fromTimestamp = new Date(Date.now() - 86_400_000);
  const rows = await analyticsStorage.getMissedAttestationsFromArchive(
    validatorIndexes,
    fromTimestamp,
  );

  return rows.map((row) => ({
    timestamp: row.timestamp.toISOString(),
    count: Number(row.count),
    validatorCount: Number(row.validator_count),
  }));
}

/**
 * GET /clusters/{id}/analytics/missed-attestations?range=1h|24h
 * Returns missed attestation data for a single cluster
 */
export const getClusterMissedAttestations = publicProcedure
  .route({ method: 'GET', path: '/clusters/{id}/analytics/missed-attestations' })
  .input(MissedAttestationsInputSchema)
  .output(ApiResponseSchema(MissedAttestationsResponseSchema))
  .handler(async ({ input }) => {
    const validatorIndexes = await getValidatorIndexesForCluster(input.id);
    const data = await fetchMissedAttestations(validatorIndexes, input.range);
    return { success: true, data, meta: { timestamp: new Date().toISOString() } };
  });

/**
 * GET /clusters/all/analytics/missed-attestations?ownerId=X&range=1h|24h
 * Returns missed attestation data aggregated across all clusters for an owner
 */
export const getAllClustersMissedAttestations = publicProcedure
  .route({ method: 'GET', path: '/clusters/all/analytics/missed-attestations' })
  .input(MissedAttestationsAllInputSchema)
  .output(ApiResponseSchema(MissedAttestationsResponseSchema))
  .handler(async ({ input }) => {
    const validatorIndexes = await getAllValidatorIndexesForOwner(input.ownerId);
    const data = await fetchMissedAttestations(validatorIndexes, input.range);
    return { success: true, data, meta: { timestamp: new Date().toISOString() } };
  });

/**
 * GET /validators/{index}/analytics/missed-attestations?range=1h|24h
 * Returns missed attestation data for a single validator
 */
export const getValidatorMissedAttestations = publicProcedure
  .route({ method: 'GET', path: '/validators/{index}/analytics/missed-attestations' })
  .input(MissedAttestationsValidatorInputSchema)
  .output(ApiResponseSchema(MissedAttestationsResponseSchema))
  .handler(async ({ input }) => {
    const data = await fetchMissedAttestations([input.index], input.range);
    return { success: true, data, meta: { timestamp: new Date().toISOString() } };
  });
