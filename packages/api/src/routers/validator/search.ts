import { ValidatorSearchInputSchema, ValidatorSearchResponseSchema } from './schemas.js';

import { securedProcedure } from '@/auth/middleware.js';
import { ValidatorStorage } from '@/storage/validator.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Search validators by index, pubkey, or withdrawal address (single or bulk)
 * GET /validators/search?index=123 or ?indexes=1,2,3 or ?pubkey=0x... or ?pubkeys=0x...,0x...
 * or ?withdrawalAddress=0x... or ?withdrawalAddresses=0x...,0x...
 */
export const searchValidators = securedProcedure
  .route({ method: 'GET', path: '/validators/search' })
  .input(ValidatorSearchInputSchema)
  .output(ApiResponseSchema(ValidatorSearchResponseSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ValidatorStorage();
      const validators: Array<{
        index: number;
        pubkey: string | null;
        withdrawalAddress: string | null;
      }> = [];

      if (input.index !== undefined) {
        const result = await storage.existsByIndex(input.index);
        if (result) {
          validators.push(result);
        }
      } else if (input.indexes && input.indexes.length > 0) {
        const results = await storage.existsByIndexes(input.indexes);
        validators.push(...results);
      } else if (input.pubkey) {
        const result = await storage.findByPubkey(input.pubkey);
        if (result) {
          validators.push(result);
        }
      } else if (input.pubkeys && input.pubkeys.length > 0) {
        const results = await storage.findByPubkeys(input.pubkeys);
        validators.push(...results);
      } else if (input.withdrawalAddress) {
        const results = await storage.findByWithdrawalAddress(input.withdrawalAddress);
        validators.push(...results);
      } else if (input.withdrawalAddresses && input.withdrawalAddresses.length > 0) {
        const results = await storage.findByWithdrawalAddresses(input.withdrawalAddresses);
        validators.push(...results);
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
      const message = error instanceof Error ? error.message : 'Failed to search validators';
      return {
        success: false,
        error: { code: 'VALIDATOR_SEARCH_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
