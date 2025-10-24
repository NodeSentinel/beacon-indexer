import { formatInTimeZone } from 'date-fns-tz';

/**
 * Converts a timestamp to UTC Date object and rounds down to the hour
 * @param timestamp - Timestamp in milliseconds
 * @returns UTC Date object with minutes and seconds set to 00:00
 */
export function getUTCDatetimeRoundedToHour(timestamp: number): Date {
  const date = new Date(timestamp);
  const dateString = formatInTimeZone(date, 'UTC', 'yyyy-MM-dd');
  const hour = Number(formatInTimeZone(date, 'UTC', 'HH'));
  const datetimeString = `${dateString}T${hour.toString().padStart(2, '0')}:00:00.000Z`;
  return new Date(datetimeString);
}

/**
 * Converts a timestamp to UTC datetime string and rounds down to the hour
 * @param timestamp - Timestamp in milliseconds
 * @returns UTC datetime string in format yyyy-MM-ddThh:00:00.000Z
 */
export function getUTCDatetimeStringRoundedToHour(timestamp: number): string {
  return getUTCDatetimeRoundedToHour(timestamp).toISOString();
}

/**
 * Converts a date to UTC using date-fns (legacy function for backward compatibility)
 * @param {Date | number} dateInput - Date object or timestamp
 * @returns {UTCDateResult} Object with UTC hours and date
 */
export function convertToUTC(dateInput: Date | number) {
  const date = new Date(dateInput);
  const isoString = date.toISOString();

  // Extract hours and date from ISO string
  const hour = Number(isoString.slice(11, 13));
  // Extract day of month from ISO string
  const day = Number(isoString.slice(8, 10));
  // Format date string as yyyy-mm-dd for PostgreSQL
  const dateString = isoString.slice(0, 10);

  return {
    hour,
    day,
    date: dateString,
  };
}
