/** Formats an ISO timestamp as a UTC date-time string. */
export function formatUtcDateTime(timestamp: string | undefined): string {
  if (!timestamp) return '-';

  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    year: 'numeric',
  }).formatToParts(date);
  const partValue = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${partValue('year')}-${partValue('month')}-${partValue('day')} ${partValue('hour')}:${partValue('minute')}:${partValue('second')} UTC`;
}
