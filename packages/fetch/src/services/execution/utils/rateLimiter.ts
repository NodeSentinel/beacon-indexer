import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

import { env } from '@/src/lib/env.js';

// Create a rate limiter per second
const limiterPerSecond = new RateLimiterMemory({
  points: env.EXECUTION_API_REQUEST_PER_SECOND,
  duration: 1, // Per second
  keyPrefix: 'per-second',
});

// Create a rate limiter per minute
// const limiterPerMinute = new RateLimiterMemory({
//   points: env.EXECUTION_API_REQUEST_PER_MINUTE,
//   duration: 60, // Per minute
//   keyPrefix: 'per-minute',
// });

// Function to limit requests
export async function limitRequests<T>(fn: () => Promise<T>): Promise<T> {
  try {
    // Consume a point from both rate limiters
    await Promise.all([
      limiterPerSecond.consume('per-second-key', 1),
      // limiterPerMinute.consume('per-minute-key', 1),
    ]);

    return fn();
  } catch (err) {
    if (err instanceof RateLimiterRes && 'msBeforeNext' in err) {
      await new Promise((resolve) => setTimeout(resolve, err.msBeforeNext));
      return limitRequests(fn);
    }
    throw err;
  }
}
