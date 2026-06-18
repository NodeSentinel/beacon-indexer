const MS_PER_HOUR = 3600 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Floor a date to the start of its UTC hour.
 * Note: date-fns startOfHour uses local timezone, so we floor manually for UTC.
 */
export function floorToUTCHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MS_PER_HOUR) * MS_PER_HOUR);
}

/**
 * Floor a date to the start of its UTC day (00:00:00).
 * Note: date-fns startOfDay uses local timezone, so we floor manually for UTC.
 */
export function floorToUTCDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MS_PER_DAY) * MS_PER_DAY);
}

/**
 * Floor a date to the start of its UTC month (1st day 00:00:00).
 * Note: date-fns startOfMonth uses local timezone, so we construct manually for UTC.
 */
export function floorToUTCMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Converts a timestamp to UTC Date object and rounds down to the hour
 * @param timestamp - Timestamp in milliseconds
 * @returns UTC Date object with minutes and seconds set to 00:00
 */
export function getUTCDatetimeFlooredToHour(timestamp: number): Date {
  return floorToUTCHour(new Date(timestamp));
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
