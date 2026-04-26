/* eslint-disable @typescript-eslint/no-explicit-any */
import { ValidatorSearchInputSchema, ValidatorSearchResponseSchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the validator search route.
 */
export function createSearchValidatorsRoute(params: {
  procedures: ApiProcedures;
  validatorStorage: any;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/validators/search' })
    .input(ValidatorSearchInputSchema)
    .output(ApiResponseSchema(ValidatorSearchResponseSchema))
    .handler(async ({ input }: any) => {
      try {
        const validators: Array<{
          index: number;
          pubkey: string | null;
          withdrawalAddress: string | null;
        }> = [];

        if (input.index !== undefined) {
          const result = await params.validatorStorage.existsByIndex(input.index);
          if (result) {
            validators.push(result);
          }
        } else if (input.indexes && input.indexes.length > 0) {
          validators.push(...(await params.validatorStorage.existsByIndexes(input.indexes)));
        } else if (input.pubkey) {
          const result = await params.validatorStorage.findByPubkey(input.pubkey);
          if (result) {
            validators.push(result);
          }
        } else if (input.pubkeys && input.pubkeys.length > 0) {
          validators.push(...(await params.validatorStorage.findByPubkeys(input.pubkeys)));
        } else if (input.withdrawalAddress) {
          validators.push(
            ...(await params.validatorStorage.findByWithdrawalAddress(input.withdrawalAddress)),
          );
        } else if (input.withdrawalAddresses && input.withdrawalAddresses.length > 0) {
          validators.push(
            ...(await params.validatorStorage.findByWithdrawalAddresses(input.withdrawalAddresses)),
          );
        } else {
          return {
            success: false,
            error: {
              code: 'INVALID_INPUT',
              message: 'Exactly one of index/es, pubkey/s or withdrawalAddress/es must be provided',
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }

        return {
          success: true,
          data: { validators },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'VALIDATOR_SEARCH_ERROR',
            message: error instanceof Error ? error.message : 'Failed to search validators',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
