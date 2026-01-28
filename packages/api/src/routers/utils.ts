import { z } from 'zod';

import { publicProcedure } from '@/lib/orpc.js';
import { beaconTime } from '@/utils/beaconTime.js';
import { ApiResponseSchema, successResponse, errorResponse } from '@/utils/response.js';

// Schema for date string input: accepts both yyyy/mm/dd hh:mm:ss and ISO format yyyy-mm-ddThh:mm:ssZ
const DateStringSchema = z.string().refine(
  (val) => {
    const isCustomFormat = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(val);
    const isISOFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(val);

    if (!isCustomFormat && !isISOFormat) {
      return false;
    }

    const dateStr = isCustomFormat
      ? val.replace(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6Z')
      : val;

    return !isNaN(new Date(dateStr).getTime());
  },
  { message: 'Date must be a valid date in format yyyy/mm/dd hh:mm:ss or yyyy-mm-ddThh:mm:ssZ' },
);

// Schema for slot number input
const SlotNumberSchema = z.number().int().nonnegative();

// Unified response schema for slot/date conversions
const SlotDateResponseSchema = ApiResponseSchema(
  z.object({
    slot: z.number(),
    date: z.string(),
    timestamp: z.number(),
  }),
);

type SlotDateResponse = z.infer<typeof SlotDateResponseSchema>;

/**
 * Convert UTC date string to slot number
 * @param date - Date string in format yyyy/mm/dd hh:mm:ss
 * @returns Slot number and original date
 */
export const dateToSlot = publicProcedure
  .route({ method: 'GET', path: '/utils/date-to-slot' })
  .input(
    z.object({
      date: DateStringSchema,
    }),
  )
  .output(SlotDateResponseSchema)
  .handler(async ({ input }) => {
    try {
      // The Zod schema has already validated the date format and its value.
      // We just need to normalize it for the `Date` constructor.
      let dateStr: string;
      if (input.date.includes('/')) {
        // Convert yyyy/mm/dd hh:mm:ss to ISO format
        dateStr = input.date.replace(
          /(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/,
          '$1-$2-$3T$4:$5:$6Z',
        );
      } else {
        // Already in ISO format
        dateStr = input.date;
      }
      const date = new Date(dateStr);

      // Convert to timestamp (milliseconds)
      const timestamp = date.getTime();

      // Get slot number from timestamp
      const slot = beaconTime.getSlotNumberFromTimestamp(timestamp);

      return successResponse({
        slot,
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

/**
 * Convert slot number to UTC date string
 * @param slot - Slot number
 * @returns UTC date string in format yyyy/mm/dd hh:mm:ss, timestamp, and slot
 */
export const slotToDate = publicProcedure
  .route({ method: 'GET', path: '/utils/slot-to-date' })
  .input(
    z.object({
      slot: z.coerce.number().int().nonnegative(), // coerce converts string query params to number
    }),
  )
  .output(SlotDateResponseSchema)
  .handler(async ({ input }) => {
    try {
      // Get timestamp from slot number
      const timestamp = beaconTime.getTimestampFromSlotNumber(input.slot);

      // Convert timestamp to Date and format as yyyy/mm/dd hh:mm:ss in UTC
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

export const utilsRouter = {
  dateToSlot,
  slotToDate,
};
