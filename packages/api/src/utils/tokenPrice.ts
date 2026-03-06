import memoizee from 'memoizee';
import ms from 'ms';

import { env } from '@/config/env.js';

async function fetchTokenPrice(): Promise<number> {
  try {
    const response = await fetch(
      `${env.COINGECKO_TOKEN_PRICE_API_URL}?ids=${env.COINGECKO_TOKEN_NAME}&vs_currencies=usd`,
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, { usd: number }>;
    return data[env.COINGECKO_TOKEN_NAME].usd;
  } catch (error) {
    console.error('Error fetching token price:', error);
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
