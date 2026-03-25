import {
  MissedAttestationsInputSchema,
  MissedAttestationsAllInputSchema,
  MissedAttestationsValidatorInputSchema,
  MissedAttestationsResponseSchema,
} from './analytics-schemas.js';

import { securedProcedure } from '@/auth/middleware.js';
import { AnalyticsStorage } from '@/storage/analytics.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { beaconTime, chainConfig } from '@/utils/beaconTime.js';
import { ApiResponseSchema } from '@/utils/response.js';

const clusterStorage = new ClusterStorage();
const analyticsStorage = new AnalyticsStorage();

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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
 * Fetch missed attestations for a set of validators within a time range.
 * '1h' reads pre-computed data from the snapshot table (consistent with performance_h).
 * '24h' uses the validator_hourly_archive table (historical hourly data).
 */
async function fetchMissedAttestations(
  validatorIndexes: number[],
  range: '1h' | '24h',
): Promise<Array<{ timestamp: string; count: number; validatorCount: number }>> {
  if (range === '1h') {
    const rows = await analyticsStorage.getMissedAttestationsFromSnapshot(
      validatorIndexes,
      chainConfig.beacon.slotsPerEpoch,
    );

    return rows.map((row) => ({
      timestamp: new Date(beaconTime.getTimestampFromEpochNumber(row.epoch)).toISOString(),
      count: Number(row.count),
      validatorCount: Number(row.validator_count),
    }));
  }

  // 24h range
  const fromTimestamp = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);
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
export const getClusterMissedAttestations = securedProcedure
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
export const getAllClustersMissedAttestations = securedProcedure
  .route({ method: 'GET', path: '/clusters/all/analytics/missed-attestations' })
  .input(MissedAttestationsAllInputSchema)
  .output(ApiResponseSchema(MissedAttestationsResponseSchema))
  .handler(async ({ input, context }) => {
    const validatorIndexes = await clusterStorage.findAllValidatorIndexesByOwner(context.user!.id);
    const data = await fetchMissedAttestations(validatorIndexes, input.range);
    return { success: true, data, meta: { timestamp: new Date().toISOString() } };
  });

/**
 * GET /validators/{index}/analytics/missed-attestations?range=1h|24h
 * Returns missed attestation data for a single validator
 */
export const getValidatorMissedAttestations = securedProcedure
  .route({ method: 'GET', path: '/validators/{index}/analytics/missed-attestations' })
  .input(MissedAttestationsValidatorInputSchema)
  .output(ApiResponseSchema(MissedAttestationsResponseSchema))
  .handler(async ({ input }) => {
    const data = await fetchMissedAttestations([input.index], input.range);
    return { success: true, data, meta: { timestamp: new Date().toISOString() } };
  });
