import { env } from '@/config/env.js';

/**
 * Token formatting utilities for chain-aware conversion
 * Based on logic from beacon-monitor-bot notifyUserStatsMessage.ts
 *
 * Rules:
 * - Base unit: 1 token = 1e9 gWei
 * - Gnosis: 1 GNO = 32 mGNO (tokenMultiplier = 32)
 * - Ethereum: 1 ETH = 1 ETH (tokenMultiplier = 1)
 */

// 1 token = 1e9 gWei
const GWEI_PER_TOKEN = BigInt(10) ** BigInt(9);

// Chain-specific token multiplier
// Gnosis: 1 GNO = 32 mGNO, Ethereum: 1 ETH = 1 ETH
const TOKEN_MULTIPLIER = env.CHAIN === 'gnosis' ? BigInt(32) : BigInt(1);

/**
 * Convert gWei (as BigInt or string) to token amount as decimal string
 * Based on bot logic: token = (gWei * 1e9) / tokenMultiplier / 1e18 = gWei / (tokenMultiplier * 1e9)
 * @param gwei - Amount in gWei (BigInt or string representation)
 * @returns Token amount as decimal string (e.g., "32.123456789")
 */
export function formatGweiToToken(gwei: bigint | string): string {
  const gweiBigInt = typeof gwei === 'string' ? BigInt(gwei) : gwei;

  // Convert gWei to wei (multiply by 1e9)
  const wei = gweiBigInt * GWEI_PER_TOKEN;

  // Apply token multiplier: divide by tokenMultiplier
  const weiAfterMultiplier = wei / TOKEN_MULTIPLIER;

  // Convert wei to token (divide by 1e18)
  // Since BigInt doesn't support decimals, we'll use string manipulation
  const weiString = weiAfterMultiplier.toString();
  const weiLength = weiString.length;

  if (weiLength <= 18) {
    // Less than 1 token
    const padded = weiString.padStart(18, '0');
    const decimalPart = padded.replace(/0+$/, '');
    return decimalPart ? `0.${decimalPart}` : '0';
  }

  // 1 token or more
  const integerPart = weiString.slice(0, -18);
  const decimalPart = weiString.slice(-18).replace(/0+$/, '');
  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
}

/**
 * Sum multiple reward parts (all in gWei) into a single BigInt
 * @param parts - Object with reward parts as BigInt or string
 * @returns Total in gWei as BigInt
 */
export function sumRewardsGwei(parts: Record<string, bigint | string | null | undefined>): bigint {
  let total = BigInt(0);

  for (const value of Object.values(parts)) {
    if (value === null || value === undefined) {
      continue;
    }
    const gweiBigInt = typeof value === 'string' ? BigInt(value) : value;
    total += gweiBigInt;
  }

  return total;
}

/**
 * Format rewards from multiple gWei parts
 * @param parts - Object with reward parts as BigInt or string
 * @returns Object with totalGwei (as string) and token (as decimal string)
 */
export function formatRewardsFromGweiParts(
  parts: Record<string, bigint | string | null | undefined>,
): {
  totalGwei: string;
  token: string;
} {
  const totalGwei = sumRewardsGwei(parts);
  const token = formatGweiToToken(totalGwei);

  return {
    totalGwei: totalGwei.toString(),
    token,
  };
}

/**
 * Format a single balance/reward value from gWei to token string
 * Convenience wrapper for formatGweiToToken
 * @param gwei - Amount in gWei (BigInt or string)
 * @returns Token amount as decimal string
 */
export function formatBalance(gwei: bigint | string | null | undefined): string {
  if (gwei === null || gwei === undefined) {
    return '0';
  }
  return formatGweiToToken(gwei);
}

/**
 * Convert mGNO to GWei (for Gnosis chain only)
 * In Gnosis: 1 GNO = 32 mGNO, 1 GNO = 1e9 GWei
 * Therefore: 1 mGNO = 1e9 / 32 GWei = 31,250,000 GWei
 * @param mGNO - Amount in mGNO (BigInt or string)
 * @returns Amount in GWei as string
 */
export function convertMGNOToGWei(mGNO: bigint | string): string {
  const mGNOBigInt = typeof mGNO === 'string' ? BigInt(mGNO) : mGNO;
  // 1 mGNO = 1e9 / 32 GWei = 31,250,000 GWei
  const gwei = (mGNOBigInt * GWEI_PER_TOKEN) / TOKEN_MULTIPLIER;
  return gwei.toString();
}

/**
 * Convert reward value from database to GWei
 * Handles both Ethereum (already in GWei) and Gnosis (stored as mGNO, needs conversion)
 * @param value - Value from database (BigInt or string)
 * @returns Value in GWei as string
 */
export function convertRewardToGWei(value: bigint | string | null | undefined): string {
  if (value === null || value === undefined) {
    return '0';
  }

  const valueBigInt = typeof value === 'string' ? BigInt(value) : value;

  if (env.CHAIN === 'gnosis') {
    // In Gnosis, rewards are stored as mGNO, convert to GWei
    return convertMGNOToGWei(valueBigInt);
  } else {
    // In Ethereum, rewards are already in GWei
    return valueBigInt.toString();
  }
}
