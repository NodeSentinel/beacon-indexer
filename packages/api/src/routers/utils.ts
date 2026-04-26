/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';

const DateStringSchema = z.string().refine(
  (value) => {
    const isCustomFormat = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
    const isISOFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value);

    if (!isCustomFormat && !isISOFormat) {
      return false;
    }

    const dateString = isCustomFormat
      ? value.replace(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6Z')
      : value;

    return !isNaN(new Date(dateString).getTime());
  },
  { message: 'Date must be a valid date in format yyyy/mm/dd hh:mm:ss or yyyy-mm-ddThh:mm:ssZ' },
);

const SlotDateResponseSchema = ApiResponseSchema(
  z.object({
    slot: z.number(),
    date: z.string(),
    timestamp: z.number(),
  }),
);

type SlotDateResponse = z.infer<typeof SlotDateResponseSchema>;

/**
 * Creates the utility conversion router.
 */
export function createUtilsRouter(params: {
  beaconHelpers: {
    beaconTime: {
      getSlotNumberFromTimestamp: (timestamp: number) => number;
      getTimestampFromSlotNumber: (slot: number) => number;
    };
  };
  procedures: ApiProcedures;
}) {
  const { securedProcedure } = params.procedures;

  const dateToSlot = securedProcedure
    .route({ method: 'GET', path: '/utils/date-to-slot' })
    .input(
      z.object({
        date: DateStringSchema,
      }),
    )
    .output(SlotDateResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        const dateString = input.date.includes('/')
          ? input.date.replace(
              /(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/,
              '$1-$2-$3T$4:$5:$6Z',
            )
          : input.date;
        const timestamp = new Date(dateString).getTime();

        return successResponse({
          slot: params.beaconHelpers.beaconTime.getSlotNumberFromTimestamp(timestamp),
          date: input.date,
          timestamp,
        }) as SlotDateResponse;
      } catch (error) {
        return errorResponse(
          'CONVERSION_ERROR',
          error instanceof Error ? error.message : 'Failed to convert date to slot',
        ) as SlotDateResponse;
      }
    });

  const slotToDate = securedProcedure
    .route({ method: 'GET', path: '/utils/slot-to-date' })
    .input(
      z.object({
        slot: z.coerce.number().int().nonnegative(),
      }),
    )
    .output(SlotDateResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        const timestamp = params.beaconHelpers.beaconTime.getTimestampFromSlotNumber(input.slot);
        const date = new Date(timestamp);
        const pad = (num: number) => String(num).padStart(2, '0');
        const dateString = `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(
          date.getUTCDate(),
        )} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;

        return successResponse({
          slot: input.slot,
          date: dateString,
          timestamp,
        }) as SlotDateResponse;
      } catch (error) {
        return errorResponse(
          'CONVERSION_ERROR',
          error instanceof Error ? error.message : 'Failed to convert slot to date',
        ) as SlotDateResponse;
      }
    });

  return {
    dateToSlot,
    slotToDate,
  };
}
