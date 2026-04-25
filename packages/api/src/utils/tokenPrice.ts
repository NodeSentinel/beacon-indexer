import memoizee from 'memoizee';
import ms from 'ms';

import type { Logger } from '@/lib/logger.js';

/**
 * Fetches the token price for one apiUrl/tokenName pair.
 */
const fetchTokenPriceCached = memoizee(
  async (apiUrl: string, tokenName: string): Promise<number> => {
    const response = await fetch(`${apiUrl}?ids=${tokenName}&vs_currencies=usd`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, { usd: number } | undefined>;
    const price = data?.[tokenName]?.usd;

    if (typeof price !== 'number') {
      throw new Error(`Token price not found for '${tokenName}'`);
    }

    return price;
  },
  {
    promise: true,
    maxAge: ms('1m'),
    preFetch: true,
    primitive: true,
  },
);

/**
 * Gets the current token price and logs failures.
 */
export async function getTokenPrice(
  apiUrl: string,
  tokenName: string,
  logger: Logger,
): Promise<number> {
  try {
    return await fetchTokenPriceCached(apiUrl, tokenName);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching token price');
    throw error;
  }
}

/**
 * Clears the shared token price cache.
 */
export function clearTokenPriceCache() {
  fetchTokenPriceCached.clear();
}
