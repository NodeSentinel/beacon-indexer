import { z } from 'zod';

import { ValidatorDetailsSchema } from './schemas.js';

import { ValidatorController } from '@/controllers/validator.js';
import { publicProcedure } from '@/lib/orpc.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Get validator details with timeline grouped by epoch → slot
 * Accepts id as path parameter - can be validatorIndex (number) or pubkey (string, 98 chars)
 * Determines type by checking if id is a number or string length
 */
export const getValidator = publicProcedure
  .route({ method: 'GET', path: '/validator/{id}' })
  .input(
    z.object({
      id: z.string(), // Path params come as strings
    }),
  )
  .output(ApiResponseSchema(ValidatorDetailsSchema))
  .handler(async ({ input }) => {
    try {
      const controller = new ValidatorController();

      // Determine if id is number or pubkey by checking if it's a valid number
      let id: number | string;
      const parsed = Number(input.id);
      if (!isNaN(parsed) && parsed > 0 && Number.isInteger(parsed)) {
        id = parsed;
      } else {
        // Otherwise treat as pubkey
        id = input.id;
      }

      const details = await controller.getDetails(id);

      return {
        success: true,
        data: details,
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get validator details';
      return {
        success: false,
        error: {
          code: 'VALIDATOR_DETAILS_ERROR',
          message,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    }
  });

export const validatorRouter = {
  getValidator,
};
