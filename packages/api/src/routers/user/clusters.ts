/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Chain } from '@beacon-indexer/beacon-utils';
import { z } from 'zod';

import { UserClusterWithValidatorsSchema, UserIdParamSchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

interface UserClusterValidatorRow {
  validatorIndex: number;
  validator: {
    withdrawalAddress: string | null;
    status: number | null;
    balance: bigint;
    effectiveBalance: bigint | null;
    pubkey: string | null;
  };
}

interface UserClusterRow {
  id: string;
  name: string;
  visibility: string;
  feeRecipientAddress: string | null;
  lidoOperatorId: string | null;
  ownerId: string;
  createdAt: Date;
  validators: UserClusterValidatorRow[];
}

interface UserClustersStorage {
  listWithValidatorsByOwner: (ownerId: string) => Promise<UserClusterRow[]>;
}

const UserClustersResponseSchema = ApiResponseSchema(z.array(UserClusterWithValidatorsSchema));
type UserClustersResponse = z.infer<typeof UserClustersResponseSchema>;

/**
 * Formats one cluster-validator membership for the token-authenticated user cluster listing.
 */
function formatUserClusterValidator(row: UserClusterValidatorRow, chain: Chain) {
  return {
    validatorIndex: row.validatorIndex,
    withdrawalAddress: row.validator.withdrawalAddress,
    status: row.validator.status,
    balance: formatBalance(row.validator.balance, chain),
    effectiveBalance:
      row.validator.effectiveBalance !== null
        ? formatBalance(row.validator.effectiveBalance, chain)
        : null,
    pubkey: row.validator.pubkey,
  };
}

/**
 * Formats one owned cluster with nested validators for API consumers.
 */
function formatUserCluster(cluster: UserClusterRow, chain: Chain) {
  return {
    id: cluster.id,
    name: cluster.name,
    visibility: cluster.visibility as 'private' | 'shared',
    feeRecipientAddress: cluster.feeRecipientAddress,
    lidoOperatorId: cluster.lidoOperatorId,
    ownerId: cluster.ownerId,
    createdAt: cluster.createdAt.toISOString(),
    validators: cluster.validators.map((validator) => formatUserClusterValidator(validator, chain)),
  };
}

/**
 * Creates the API-key route that lists clusters and validators for a provided user id.
 */
export function createUserClustersRoute(params: {
  chain: Chain;
  clusterStorage: UserClustersStorage;
  procedures: ApiProcedures;
}) {
  const { apiKeyProcedure } = params.procedures;

  return apiKeyProcedure
    .route({ method: 'GET', path: '/users/{userId}/clusters' })
    .input(UserIdParamSchema)
    .output(UserClustersResponseSchema)
    .handler(async ({ input }) => {
      try {
        const clusters = await params.clusterStorage.listWithValidatorsByOwner(input.userId);

        return successResponse(
          clusters.map((cluster) => formatUserCluster(cluster, params.chain)),
        ) as UserClustersResponse;
      } catch (error) {
        return errorResponse(
          'USER_CLUSTERS_LIST_ERROR',
          error instanceof Error ? error.message : 'Failed to list user clusters',
        ) as UserClustersResponse;
      }
    });
}
