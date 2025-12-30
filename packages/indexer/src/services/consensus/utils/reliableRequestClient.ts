import { AxiosError } from 'axios';
import ms from 'ms';
import pLimit from 'p-limit';
import pRetry from 'p-retry';

import createLogger from '@/src/lib/pino.js';

const retryLogger = createLogger('ReliableRequest');

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
    fullNodeUrl,
    fullNodeConcurrency,
    fullNodeRetries,
    archiveNodeUrl,
    archiveNodeConcurrency,
    archiveNodeRetries,
    baseDelay,
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
   * Calculate exponential backoff delay
   */
  protected calculateBackoffDelay(attempt: number): number {
    return this.baseDelay * Math.pow(2, attempt);
  }

  /**
   * Call API endpoint with specified retries and error handling
   * TODO: if 404 and near head, minTimeout should start in a half of slot time.
   * if error is not 429 (rate limit), think about it, perhaps 2s is enough.
   * if error if another, keep trying.
   * think about retries, it should be big enough but limit the backoff to not than 1m.
   * if there are many failed attempts, we need to notify the admin about it.
   */
  protected async callAPI<T>(
    callEndpoint: (url: string) => Promise<T>,
    retries: number,
    url: string,
    nodeType: 'full' | 'archive',
    errorHandler?: (error: AxiosError<{ message: string }>) => T | undefined,
  ): Promise<T> {
    // Select the appropriate limit based on node type
    const limit = nodeType === 'full' ? this.fullNodeLimit : this.archiveNodeLimit;

    return await limit(() =>
      pRetry(
        async () => {
          try {
            return await callEndpoint(url);
          } catch (error) {
            // If errorHandler is provided, try to handle the error before retrying
            // If the handler can handle it (returns a value), return it immediately
            // This prevents unnecessary retries for errors like 404
            if (errorHandler && error instanceof AxiosError) {
              const handled = errorHandler(error);
              if (handled !== undefined) {
                // Return the handled value directly - p-retry won't retry on success
                return handled;
              }
            }
            // If errorHandler didn't handle it or doesn't exist, re-throw to continue retries
            throw error;
          }
        },
        {
          retries,
          minTimeout: ms('1s'),
          onFailedAttempt: async (error: unknown) => {
            // p-retry adds attemptNumber property to the error object
            const attemptNumber = (error as { attemptNumber?: number }).attemptNumber || 0;
            // Extract endpoint from the error (if it's an AxiosError)
            const endpoint = extractEndpointFromError(error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            const statusCode = error instanceof AxiosError ? error.response?.status : undefined;

            // Only log retries in DEBUG mode
            const isDebugLevel = process.env.LOG_LEVEL === 'debug';
            if (isDebugLevel) {
              retryLogger.debug(`Failed attempt ${attemptNumber} for ${endpoint}`, {
                error: errorMessage,
                statusCode,
              });
            }
            const delay = this.calculateBackoffDelay(attemptNumber);
            await new Promise((resolve) => setTimeout(resolve, delay));
          },
        },
      ),
    );
  }

  /**
   * Enhanced request method with concurrency control, exponential backoff, and fallback
   */
  protected async makeReliableRequest<T>(
    callEndpoint: (url: string) => Promise<T>,
    nodeType: 'full' | 'archive',
    errorHandler?: (error: AxiosError<{ message: string }>) => T | undefined,
  ): Promise<T> {
    // If nodeType is 'full', try with fullNodeRetries first, then fallback to archive logic
    if (nodeType === 'full') {
      try {
        return await this.callAPI(
          callEndpoint,
          this.fullNodeRetries,
          this.fullNodeUrl,
          'full',
          errorHandler,
        );
      } catch {
        return await this.callAPI(
          callEndpoint,
          this.archiveNodeRetries,
          this.archiveNodeUrl,
          'archive',
          errorHandler,
        );
      }
    } else {
      // If nodeType is 'archive', use archive node directly with archiveNodeRetries
      return await this.callAPI(
        callEndpoint,
        this.archiveNodeRetries,
        this.archiveNodeUrl,
        'archive',
        errorHandler,
      );
    }
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
