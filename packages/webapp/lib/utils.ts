import { clsx, type ClassValue } from 'clsx';
import { format, formatDuration, intervalToDuration, parseISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';

type DurationFormatConstructor = new (
  locales?: string | string[],
  options?: {
    style?: 'long' | 'short' | 'narrow' | 'digital';
    days?: 'long' | 'short' | 'narrow';
    daysDisplay?: 'auto' | 'always';
    hours?: 'long' | 'short' | 'narrow' | 'numeric' | '2-digit';
    hoursDisplay?: 'auto' | 'always';
    minutes?: 'long' | 'short' | 'narrow' | 'numeric' | '2-digit';
    minutesDisplay?: 'auto' | 'always';
  },
) => {
  format(duration: { days?: number; hours?: number; minutes?: number }): string;
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Formats an incident timestamp as dd/MM HH:mm. */
export function formatIncidentDateTime(timestamp: string): string {
  return format(parseISO(timestamp), 'dd/MM HH:mm');
}

/** Formats incident duration seconds or derives it from open and close timestamps. */
export function formatIncidentDuration({
  closedAt,
  durationSeconds,
  openedAt,
}: {
  closedAt: string | null;
  durationSeconds: number | null;
  openedAt: string;
}): string {
  const resolvedDurationSeconds =
    durationSeconds ??
    Math.max(
      0,
      Math.floor(
        ((closedAt ? parseISO(closedAt) : new Date()).getTime() - parseISO(openedAt).getTime()) /
          1000,
      ),
    );

  if (resolvedDurationSeconds === 0) return '0 seconds';

  return formatDuration(
    intervalToDuration({
      start: 0,
      end: resolvedDurationSeconds * 1000,
    }),
    {
      format: ['days', 'hours', 'minutes', 'seconds'],
      zero: false,
    },
  );
}

/** Formats an incident duration with compact units and without seconds. */
export function formatIncidentDurationCompact({
  closedAt,
  durationSeconds,
  openedAt,
}: {
  closedAt: string | null;
  durationSeconds: number | null;
  openedAt: string;
}): string {
  const resolvedDurationSeconds =
    durationSeconds ??
    Math.max(
      0,
      Math.floor(
        ((closedAt ? parseISO(closedAt) : new Date()).getTime() - parseISO(openedAt).getTime()) /
          1000,
      ),
    );

  const duration = intervalToDuration({
    start: 0,
    end: resolvedDurationSeconds * 1000,
  });

  const durationFormatIntl = Intl as typeof Intl & {
    DurationFormat: DurationFormatConstructor;
  };

  const formatter = new durationFormatIntl.DurationFormat('en', {
    style: 'narrow',
    days: 'narrow',
    daysDisplay: 'auto',
    hours: 'narrow',
    hoursDisplay: 'auto',
    minutes: 'narrow',
    minutesDisplay: 'auto',
  });

  return formatter.format({
    days: duration.days,
    hours: duration.hours,
    minutes: duration.minutes,
  });
}

const WEI_PER_GWEI = 10 ** 9;
const WEI_PER_ETH = 10 ** 18;

/**
 * Convert wei to gwei (divide by 10^9).
 * Use for displaying reward/balance values that come in wei.
 */
export function weiToGwei(value: number | string): number {
  const num = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(num)) return 0;
  return num / WEI_PER_GWEI;
}

/**
 * Convert wei to token (ETH or GNO, divide by 10^18).
 * Use for displaying reward/balance values in token units.
 */
export function weiToETH(value: number | string): number {
  const num = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(num)) return 0;
  return num / WEI_PER_ETH;
}

/**
 * Format a number with thousand separators.
 * Accepts number or string (e.g. from API).
 * @param maxDecimals - Max decimal places (default 2)
 */
export function formatNumber(value: number | string, maxDecimals = 2): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(num)) return '0';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

/** Display unit for reward values in gwei */
export const REWARD_UNIT = 'GWei';

/** Token symbol from chain (NEXT_PUBLIC_CHAIN). Use from env in components. */
export function getTokenSymbol(chain: 'gnosis' | 'ethereum'): string {
  return chain === 'gnosis' ? 'GNO' : 'ETH';
}
