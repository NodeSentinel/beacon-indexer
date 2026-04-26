/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  MissedAttestationsAllInputSchema,
  MissedAttestationsInputSchema,
  MissedAttestationsResponseSchema,
  MissedAttestationsValidatorInputSchema,
} from './analytics-schemas.js';
import { requireOwnedCluster } from './ownership.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Loads validator indexes for one cluster.
 */
async function getValidatorIndexesForCluster(
  params: { clusterStorage: any },
  clusterId: string,
): Promise<number[]> {
  const cluster = await params.clusterStorage.findByIdWithValidators(clusterId);
  return cluster ? cluster.validators.map((validator: any) => validator.validatorIndex) : [];
}

/**
 * Loads missed attestation rows for the requested range.
 */
async function fetchMissedAttestations(
  params: {
    analyticsStorage: any;
    beaconHelpers: any;
    clusterStorage: any;
  },
  validatorIndexes: number[],
  range: '1h' | '24h',
): Promise<Array<{ timestamp: string; count: number; validatorCount: number }>> {
  if (range === '1h') {
    const rows = await params.analyticsStorage.getMissedAttestationsFromSnapshot(
      validatorIndexes,
      params.beaconHelpers.chainConfig.beacon.slotsPerEpoch,
    );

    return rows.map((row: any) => ({
      timestamp: new Date(
        params.beaconHelpers.beaconTime.getTimestampFromEpochNumber(row.epoch),
      ).toISOString(),
      count: Number(row.count),
      validatorCount: Number(row.validator_count),
    }));
  }

  const rows = await params.analyticsStorage.getMissedAttestationsFromArchive(
    validatorIndexes,
    new Date(Date.now() - TWENTY_FOUR_HOURS_MS),
  );

  return rows.map((row: any) => ({
    timestamp: row.timestamp.toISOString(),
    count: Number(row.count),
    validatorCount: Number(row.validator_count),
  }));
}

/**
 * Creates the cluster missed-attestations route.
 */
export function createClusterMissedAttestationsRoute(params: {
  analyticsStorage: any;
  beaconHelpers: any;
  clusterStorage: any;
  procedures: ApiProcedures;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/clusters/{id}/analytics/missed-attestations' })
    .input(MissedAttestationsInputSchema)
    .output(ApiResponseSchema(MissedAttestationsResponseSchema))
    .handler(async ({ context, input }: any) => {
      const ownershipError = await requireOwnedCluster(
        params.clusterStorage,
        input.id,
        context.user,
      );
      if (ownershipError) {
        return ownershipError;
      }

      return {
        success: true,
        data: await fetchMissedAttestations(
          params,
          await getValidatorIndexesForCluster(params, input.id),
          input.range,
        ),
        meta: { timestamp: new Date().toISOString() },
      };
    });
}

/**
 * Creates the all-clusters missed-attestations route.
 */
export function createAllClustersMissedAttestationsRoute(params: {
  analyticsStorage: any;
  beaconHelpers: any;
  clusterStorage: any;
  procedures: ApiProcedures;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/clusters/all/analytics/missed-attestations' })
    .input(MissedAttestationsAllInputSchema)
    .output(ApiResponseSchema(MissedAttestationsResponseSchema))
    .handler(async ({ context, input }: any) => {
      if (!context.user) {
        return {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      return {
        success: true,
        data: await fetchMissedAttestations(
          params,
          await params.clusterStorage.findAllValidatorIndexesByOwner(context.user.id),
          input.range,
        ),
        meta: { timestamp: new Date().toISOString() },
      };
    });
}

/**
 * Creates the validator missed-attestations route.
 */
export function createValidatorMissedAttestationsRoute(params: {
  analyticsStorage: any;
  beaconHelpers: any;
  clusterStorage: any;
  procedures: ApiProcedures;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/validators/{index}/analytics/missed-attestations' })
    .input(MissedAttestationsValidatorInputSchema)
    .output(ApiResponseSchema(MissedAttestationsResponseSchema))
    .handler(async ({ input }: any) => ({
      success: true,
      data: await fetchMissedAttestations(params, [input.index], input.range),
      meta: { timestamp: new Date().toISOString() },
    }));
}
