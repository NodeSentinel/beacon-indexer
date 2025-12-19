import { z } from 'zod';

import { publicProcedure } from '@/lib/orpc.js';
import { beaconTime } from '@/utils/beaconTime.js';
import { ApiResponseSchema } from '@/utils/response.js';

// Schema for date string input: accepts both yyyy/mm/dd hh:mm:ss and ISO format yyyy-mm-ddThh:mm:ssZ
const DateStringSchema = z.string().refine(
  (val) => {
    return (
      /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(val) ||
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(val)
    );
  },
  { message: 'Date must be in format yyyy/mm/dd hh:mm:ss or yyyy-mm-ddThh:mm:ssZ' },
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

/**
 * Convert UTC date string to slot number
 * @param date - Date string in format yyyy/mm/dd hh:mm:ss
 * @returns Slot number and original date
 */
export const dateToSlot = publicProcedure
  .input(
    z.object({
      date: DateStringSchema,
    }),
  )
  .output(SlotDateResponseSchema)
  .handler(async ({ input }) => {
    try {
      // Parse date string: accepts both yyyy/mm/dd hh:mm:ss and ISO format yyyy-mm-ddThh:mm:ssZ
      // Normalize to ISO format for Date parsing
      let dateStr: string;
      if (/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(input.date)) {
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

      // Validate date
      if (isNaN(date.getTime())) {
        return {
          success: false,
          error: {
            code: 'INVALID_DATE',
            message: 'Invalid date format or date value',
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Convert to timestamp (milliseconds)
      const timestamp = date.getTime();

      // Get slot number from timestamp
      const slot = beaconTime.getSlotNumberFromTimestamp(timestamp);

      return {
        success: true,
        data: {
          slot,
          date: input.date,
          timestamp,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CONVERSION_ERROR',
          message: error instanceof Error ? error.message : 'Failed to convert date to slot',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    }
  });

/**
 * Convert slot number to UTC date string
 * @param slot - Slot number
 * @returns UTC date string in format yyyy/mm/dd hh:mm:ss, timestamp, and slot
 */
export const slotToDate = publicProcedure
  .input(
    z.object({
      slot: SlotNumberSchema,
    }),
  )
  .output(SlotDateResponseSchema)
  .handler(async ({ input }) => {
    try {
      // Get timestamp from slot number
      const timestamp = beaconTime.getTimestampFromSlotNumber(input.slot);

      // Convert timestamp to Date and format as yyyy/mm/dd hh:mm:ss in UTC
      const date = new Date(timestamp);
      const dateString = date
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '')
        .replace(/-/g, '/');

      return {
        success: true,
        data: {
          slot: input.slot,
          date: dateString,
          timestamp,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CONVERSION_ERROR',
          message: error instanceof Error ? error.message : 'Failed to convert slot to date',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    }
  });

export const utilsRouter = {
  dateToSlot,
  slotToDate,
};
