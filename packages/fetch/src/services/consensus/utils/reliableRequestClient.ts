import { AxiosError } from 'axios';
import ms from 'ms';
import pLimit from 'p-limit';
import pRetry from 'p-retry';

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
   */
  protected async callAPI<T>(
    callEndpoint: (url: string) => Promise<T>,
    retries: number,
    url: string,
    nodeType: 'full' | 'archive',
    errorHandler?: (error: AxiosError<{ message: string }>) => T | undefined,
  ): Promise<T> {
    try {
      // Select the appropriate limit based on node type
      const limit = nodeType === 'full' ? this.fullNodeLimit : this.archiveNodeLimit;
      return await limit(() =>
        pRetry(() => callEndpoint(url), {
          retries,
          minTimeout: ms('1s'),
          onFailedAttempt: async (error: { attemptNumber: number; message: string }) => {
            console.log(
              `Failed attempt ${error.attemptNumber} for ${url}. Error: ${error.message}`,
            );
            const delay = this.calculateBackoffDelay(error.attemptNumber);
            await new Promise((resolve) => setTimeout(resolve, delay));
          },
        }),
      );
    } catch (error) {
      // Try to handle the error if handler provided
      if (errorHandler) {
        const handled = errorHandler(error as AxiosError<{ message: string }>);
        if (handled !== undefined) {
          return handled;
        }
      }

      throw error;
    }
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
