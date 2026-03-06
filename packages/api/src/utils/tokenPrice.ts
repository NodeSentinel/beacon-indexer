import memoizee from 'memoizee';
import ms from 'ms';

import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';

async function fetchTokenPrice(): Promise<number> {
  try {
    const response = await fetch(
      `${env.COINGECKO_TOKEN_PRICE_API_URL}?ids=${env.COINGECKO_TOKEN_NAME}&vs_currencies=usd`,
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, { usd: number } | undefined>;
    const price = data?.[env.COINGECKO_TOKEN_NAME]?.usd;
    if (typeof price !== 'number') {
      throw new Error(`Token price not found for '${env.COINGECKO_TOKEN_NAME}'`);
    }
    return price;
  } catch (error) {
    logger.error({ err: error }, 'Error fetching token price');
    throw error;
  }
}

// Memoize the function with a 1-minute TTL
export const getTokenPrice = memoizee(fetchTokenPrice, {
  promise: true,
  maxAge: ms('1m'),
  preFetch: true,
  primitive: true,
});

export const clearTokenPriceCache = () => {
  getTokenPrice.clear();
};
