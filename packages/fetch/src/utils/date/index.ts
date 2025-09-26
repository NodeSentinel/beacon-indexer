/**
 * Converts a date to UTC using native JavaScript methods
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
