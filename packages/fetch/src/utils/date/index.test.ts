import { fromZonedTime } from 'date-fns-tz';
import { describe, it, expect } from 'vitest';

import { getUTCDatetimeRoundedToHour } from './index.js';

describe('Date utilities', () => {
  describe('getUTCDatetimeRoundedToHour', () => {
    it('should convert timestamp to UTC Date object correctly', () => {
      // Test with a known timestamp: 2024-01-15 14:30:00 UTC
      const timestamp = new Date('2024-01-15T14:30:00.000Z').getTime();
      const result = getUTCDatetimeRoundedToHour(timestamp);

      expect(result.toISOString()).toBe('2024-01-15T14:00:00.000Z');
    });

    it('should handle midnight correctly', () => {
      // Test with midnight UTC
      const timestamp = new Date('2024-01-15T00:00:00.000Z').getTime();
      const result = getUTCDatetimeRoundedToHour(timestamp);

      expect(result.toISOString()).toBe('2024-01-15T00:00:00.000Z');
    });

    it('should handle end of day correctly', () => {
      // Test with 23:59:59 UTC
      const timestamp = new Date('2024-01-15T23:59:59.999Z').getTime();
      const result = getUTCDatetimeRoundedToHour(timestamp);

      expect(result.toISOString()).toBe('2024-01-15T23:00:00.000Z');
    });

    it('should always return UTC regardless of local timezone', () => {
      // Test with a timestamp that would be different in different timezones
      const timestamp = new Date('2024-01-15T12:00:00.000Z').getTime();
      const result = getUTCDatetimeRoundedToHour(timestamp);

      expect(result.toISOString()).toBe('2024-01-15T12:00:00.000Z');
    });

    it('should work correctly with Argentina timezone (UTC-3)', () => {
      // Create a date in Argentina timezone (UTC-3)
      // Argentina: 2024-01-15 14:30:00 (UTC-3) = 2024-01-15 17:30:00 UTC
      const argentinaDateString = '2024-01-15T14:30:00';
      const utcDate = fromZonedTime(argentinaDateString, 'America/Argentina/Buenos_Aires');
      const timestamp = utcDate.getTime();

      const result = getUTCDatetimeRoundedToHour(timestamp);

      // Should return UTC time (17:00:00.000Z), not Argentina time
      expect(result.toISOString()).toBe('2024-01-15T17:00:00.000Z');
    });
  });
});
