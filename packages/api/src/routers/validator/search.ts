import { ValidatorSearchInputSchema, ValidatorSearchResponseSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ValidatorStorage } from '@/storage/validator.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Search validators by index, pubkey, or withdrawal address
 * GET /validators/search?index=123 or ?pubkey=0x... or ?withdrawalAddress=0x...
 */
export const searchValidators = publicProcedure
  .route({ method: 'GET', path: '/validators/search' })
  .input(ValidatorSearchInputSchema)
  .output(ApiResponseSchema(ValidatorSearchResponseSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ValidatorStorage();
      const validators: Array<{ index: number; pubkey: string | null }> = [];

      if (input.index !== undefined) {
        const result = await storage.existsByIndex(input.index);
        if (result) {
          validators.push(result);
        }
      } else if (input.pubkey) {
        const result = await storage.findByPubkey(input.pubkey);
        if (result) {
          validators.push(result);
        }
      } else if (input.withdrawalAddress) {
        const results = await storage.findByWithdrawalAddress(input.withdrawalAddress);
        validators.push(...results.map((r) => ({ index: r.index, pubkey: r.pubkey })));
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
