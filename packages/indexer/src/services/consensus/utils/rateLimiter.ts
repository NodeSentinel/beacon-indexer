import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

import { env } from '@/src/lib/env.js';

// Singleton instance
let instance: RateLimiterMemory | null = null;

// Get or create rate limiter instance
function getRateLimiter(): RateLimiterMemory {
  if (!instance) {
    instance = new RateLimiterMemory({
      points: env.CONSENSUS_API_REQUEST_PER_SECOND,
      duration: 1, // Per second
      keyPrefix: '',
    });
  }
  return instance;
}

// Function to limit requests
export async function limitRequests(): Promise<void> {
  const limiter = getRateLimiter();
  try {
    // Consume a point from rate limiter
    await limiter.consume('');
  } catch (err) {
    if (err instanceof RateLimiterRes && 'msBeforeNext' in err) {
      // Delay the request if it exceeds the limit
      await new Promise((resolve) => setTimeout(resolve, err.msBeforeNext + 500));
      return limitRequests();
    }
    throw err;
  }
}
