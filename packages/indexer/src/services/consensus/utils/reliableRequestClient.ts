import { AxiosError } from 'axios';
import pLimit from 'p-limit';

import createLogger from '@/src/lib/pino.js';

const retryLogger = createLogger('ReliableRequest');
const FIBONACCI_RETRY_DELAY_STEPS = [1, 2, 3, 5, 8] as const;

type RequestAttempt = {
  nodeType: 'full' | 'archive';
  url: string;
};

/**
 * Extract endpoint path from a full URL or AxiosError
 * Returns just the path and query string, without the base URL
 */
function extractEndpointPath(url: string | undefined): string {
  if (!url) return 'unknown';
  try {
    const urlObj = new URL(url);
    return urlObj.pathname + urlObj.search;
  } catch {
    // If URL parsing fails, try to extract path manually
    const match = url.match(/https?:\/\/[^/]+(\/.*)/);
    return match ? match[1] : url;
  }
}

/**
 * Extract endpoint from an AxiosError
 */
function extractEndpointFromError(error: unknown): string {
  if (error instanceof AxiosError) {
    return extractEndpointPath(
      error.config?.url || error.request?.url || error.response?.config?.url,
    );
  }
  return 'unknown';
}

/**
 * Base class that provides reliable request functionality with concurrency control,
 * exponential backoff, and fallback strategies
 */
export abstract class ReliableRequestClient {
  protected readonly fullNodeLimit: ReturnType<typeof pLimit>;
  protected readonly archiveNodeLimit: ReturnType<typeof pLimit>;
  protected readonly baseDelay: number;
  protected readonly fullNodeUrl: string;
  protected readonly archiveNodeUrl: string;
  protected readonly fullNodeRetries: number;
  protected readonly archiveNodeRetries: number;

  constructor({
    archiveNodeConcurrency,
    archiveNodeRetries,
    archiveNodeUrl,
    baseDelay,
    fullNodeConcurrency,
    fullNodeRetries,
    fullNodeUrl,
  }: {
    fullNodeUrl: string;
    fullNodeConcurrency: number;
    fullNodeRetries: number;
    archiveNodeUrl: string;
    archiveNodeConcurrency: number;
    archiveNodeRetries: number;
    baseDelay: number;
  }) {
    this.fullNodeLimit = pLimit(fullNodeConcurrency);
    this.archiveNodeLimit = pLimit(archiveNodeConcurrency);
    this.baseDelay = baseDelay;
    this.fullNodeUrl = fullNodeUrl;
    this.archiveNodeUrl = archiveNodeUrl;
    this.fullNodeRetries = fullNodeRetries;
    this.archiveNodeRetries = archiveNodeRetries;
  }

  /**
   * Calculate the Fibonacci backoff delay for a failed attempt.
   */
  protected calculateBackoffDelay(attempt: number): number {
    // Clamp the attempt-based index so retries beyond the configured sequence keep using the last delay.
    const requestedDelayIndex = attempt - 1;
    const maxDelayIndex = FIBONACCI_RETRY_DELAY_STEPS.length - 1;
    const delayIndex = Math.min(Math.max(requestedDelayIndex, 0), maxDelayIndex);

    return this.baseDelay * FIBONACCI_RETRY_DELAY_STEPS[delayIndex];
  }

  /**
   * Build the ordered node sequence for a reliable request.
   */
  private getAttemptSequence(nodeType: 'full' | 'archive'): RequestAttempt[] {
    if (nodeType === 'archive') {
      return Array.from({ length: this.archiveNodeRetries + 1 }, () => ({
        nodeType: 'archive' as const,
        url: this.archiveNodeUrl,
      }));
    }

    return [
      ...Array.from({ length: this.fullNodeRetries + 1 }, () => ({
        nodeType: 'full' as const,
        url: this.fullNodeUrl,
      })),
      ...Array.from({ length: this.archiveNodeRetries + 1 }, () => ({
        nodeType: 'archive' as const,
        url: this.archiveNodeUrl,
      })),
    ];
  }

  /**
   * Wait between XState-visible request attempts without holding a concurrency slot.
   */
  private async waitBeforeRetry(attempt: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.calculateBackoffDelay(attempt)));
  }

  /**
   * Log failed request attempts only when debug logging is enabled.
   */
  private logFailedAttempt(error: unknown, attemptNumber: number): void {
    if (process.env.LOG_LEVEL !== 'debug') {
      return;
    }

    const endpoint = extractEndpointFromError(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const statusCode = error instanceof AxiosError ? error.response?.status : undefined;

    retryLogger.debug(`Failed attempt ${attemptNumber} for ${endpoint}`, {
      error: errorMessage,
      statusCode,
    });
  }

  /**
   * Call one API endpoint attempt with concurrency control and optional error handling.
   * TODO: if 404 and near head, minTimeout should start in a half of slot time.
   * if error is not 429 (rate limit), think about it, perhaps 2s is enough.
   * if error if another, keep trying.
   * think about retries, it should be big enough but limit the backoff to not than 1m.
   * if there are many failed attempts, we need to notify the admin about it.
   */
  protected async callAPI<T>(
    callEndpoint: (url: string) => Promise<T>,
    _retries: number,
    url: string,
    nodeType: 'full' | 'archive',
    errorHandler?: (error: AxiosError<{ message: string }>) => T | undefined,
  ): Promise<T> {
    // Select the appropriate limit based on node type
    const limit = nodeType === 'full' ? this.fullNodeLimit : this.archiveNodeLimit;

    return await limit(async () => {
      try {
        return await callEndpoint(url);
      } catch (error) {
        // Error handlers convert domain-specific failures, like missed slots, into values.
        if (errorHandler && error instanceof AxiosError) {
          const handled = errorHandler(error);
          if (handled !== undefined) {
            return handled;
          }
        }

        throw error;
      }
    });
  }

  /**
   * Enhanced request method with concurrency control, exponential backoff, and fallback
   */
  protected async makeReliableRequest<T>(
    callEndpoint: (url: string) => Promise<T>,
    nodeType: 'full' | 'archive',
    errorHandler?: (error: AxiosError<{ message: string }>) => T | undefined,
  ): Promise<T> {
    const attempts = this.getAttemptSequence(nodeType);
    let lastError: unknown;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
      const attemptNumber = attemptIndex + 1;
      const attempt = attempts[attemptIndex];

      try {
        return await this.callAPI(callEndpoint, 0, attempt.url, attempt.nodeType, errorHandler);
      } catch (error) {
        lastError = error;
        if (attemptIndex === attempts.length - 1) {
          break;
        }

        this.logFailedAttempt(error, attemptNumber);
        await this.waitBeforeRetry(attemptNumber);
      }
    }

    throw lastError;
  }

  /**
   * Get current concurrency statistics for both node types
   */
  getConcurrencyStats() {
    return {
      fullNode: {
        activeCount: this.fullNodeLimit.activeCount,
        pendingCount: this.fullNodeLimit.pendingCount,
        concurrency: this.fullNodeLimit.concurrency,
      },
      archiveNode: {
        activeCount: this.archiveNodeLimit.activeCount,
        pendingCount: this.archiveNodeLimit.pendingCount,
        concurrency: this.archiveNodeLimit.concurrency,
      },
    };
  }

  /**
   * Clear the request queue for both node types
   */
  clearQueue() {
    this.fullNodeLimit.clearQueue();
    this.archiveNodeLimit.clearQueue();
  }
}
