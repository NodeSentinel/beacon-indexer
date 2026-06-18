/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import { ValidatorDetailsSchema } from './schemas.js';
import { createSearchValidatorsRoute } from './search.js';

import type { ApiDependencies } from '@/dependencies.js';
import { createValidatorMissedAttestationsRoute } from '@/routers/cluster/missed-attestations.js';
import { createValidatorRewardsRoute } from '@/routers/cluster/rewards.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the validator router.
 */
export function createValidatorRouter(
  deps: Pick<
    ApiDependencies,
    | 'analyticsStorage'
    | 'beaconHelpers'
    | 'chain'
    | 'clusterStorage'
    | 'executionRpcUrl'
    | 'logger'
    | 'nativeTokenDecimals'
    | 'procedures'
    | 'tokenPriceApiUrl'
    | 'tokenPriceTokenName'
    | 'validatorController'
    | 'validatorStorage'
  >,
) {
  const { securedProcedure } = deps.procedures;

  const getValidator = securedProcedure
    .route({ method: 'GET', path: '/validator/{id}' })
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .output(ApiResponseSchema(ValidatorDetailsSchema))
    .handler(async ({ input }: any) => {
      try {
        let id: number | string;
        const parsed = Number(input.id);

        if (!isNaN(parsed) && parsed > 0 && Number.isInteger(parsed)) {
          id = parsed;
        } else {
          id = input.id;
        }

        const details = await deps.validatorController.getDetails(id);

        return {
          success: true,
          data: details,
          meta: {
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'VALIDATOR_DETAILS_ERROR',
            message: error instanceof Error ? error.message : 'Failed to get validator details',
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        };
      }
    });

  return {
    getValidator,
    missedAttestations: createValidatorMissedAttestationsRoute(deps),
    rewards: createValidatorRewardsRoute(deps),
    search: createSearchValidatorsRoute(deps),
  };
}
