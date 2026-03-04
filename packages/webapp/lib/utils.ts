import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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

/**
 * Format a number in compact notation (e.g. 1.5M, 320k).
 * Falls back to formatNumber for values below 1,000.
 */
export function formatCompactNumber(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '0';
  if (num >= 1_000_000) return `${formatNumber(num / 1_000_000)}M`;
  if (num >= 1_000) return `${formatNumber(num / 1_000)}k`;
  return formatNumber(num);
}

/** Token symbol from chain (NEXT_PUBLIC_CHAIN). Use from env in components. */
export function getTokenSymbol(chain: 'gnosis' | 'ethereum'): string {
  return chain === 'gnosis' ? 'GNO' : 'ETH';
}
