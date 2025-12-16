import { formatInTimeZone } from 'date-fns-tz';

/**
 * Converts a timestamp to UTC Date object and rounds down to the hour
 * @param timestamp - Timestamp in milliseconds
 * @returns UTC Date object with minutes and seconds set to 00:00
 */
export function getUTCDatetimeFlooredToHour(timestamp: number): Date {
  const msPerHour = 60 * 60 * 1000;
  return new Date(Math.floor(timestamp / msPerHour) * msPerHour);
}

/**
 * Converts a timestamp to UTC datetime string and rounds down to the hour
 * @param timestamp - Timestamp in milliseconds
 * @returns UTC datetime string in format yyyy-MM-ddThh:00:00.000Z
 */
export function getUTCDatetimeStringFlooredToHour(timestamp: number): string {
  return getUTCDatetimeFlooredToHour(timestamp).toISOString();
}

/**
 * Converts a date to UTC using date-fns (legacy function for backward compatibility)
 * @param {Date | number} dateInput - Date object or timestamp
 * @returns {UTCDateResult} Object with UTC hours and date
 */
export function convertToUTC(dateInput: Date | number) {
  const date = new Date(dateInput);

  return {
    hour: date.getUTCHours(),
    day: date.getUTCDate(),
    date: date.toISOString().slice(0, 10),
  };
}
