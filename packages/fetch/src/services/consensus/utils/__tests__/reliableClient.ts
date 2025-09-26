import { ReliableRequestClient } from '@/src/services/consensus/utils/reliableRequestClient.js';

/**
 * Test class that inherits from ReliableRequestClient for testing purposes
 * Overrides the callAPI method to use shorter timeouts for faster tests
 */
export class TestReliableClient extends ReliableRequestClient {
  constructor({
    fullNodeConcurrency,
    archiveNodeConcurrency,
    fullNodeUrl,
    archiveNodeUrl,
    baseDelay,
    fullNodeRetries = 3,
    archiveNodeRetries = 5,
  }: {
    fullNodeConcurrency: number;
    archiveNodeConcurrency: number;
    fullNodeUrl: string;
    archiveNodeUrl: string;
    baseDelay: number;
    fullNodeRetries?: number;
    archiveNodeRetries?: number;
  }) {
    super({
      fullNodeConcurrency,
      archiveNodeConcurrency,
      fullNodeUrl,
      archiveNodeUrl,
      baseDelay,
      fullNodeRetries,
      archiveNodeRetries,
    });
  }

  /**
   * Test method 1 for full nodes: Simple request that always succeeds
   */
  async method1Full(): Promise<string> {
    return this.makeReliableRequest(async (url) => {
      const response = await fetch(`${url}/test`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.text();
    }, 'full');
  }

  /**
   * Test method 2 for full nodes: Request that fails first, then succeeds (for retry testing)
   */
  async method2Full(): Promise<string> {
    return this.makeReliableRequest(async (url) => {
      const response = await fetch(`${url}/test-retry`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.text();
    }, 'full');
  }

  /**
   * Test method 1 for archive nodes: Simple request that always succeeds
   */
  async method1Archive(): Promise<string> {
    return this.makeReliableRequest(async (url) => {
      const response = await fetch(`${url}/test`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.text();
    }, 'archive');
  }

  /**
   * Test method 2 for archive nodes: Request that fails first, then succeeds (for retry testing)
   */
  async method2Archive(): Promise<string> {
    return this.makeReliableRequest(async (url) => {
      const response = await fetch(`${url}/test-retry`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.text();
    }, 'archive');
  }

  /**
   * Override callAPI to use shorter minTimeout for faster tests
   */
  protected async callAPI<T>(
    callEndpoint: (url: string) => Promise<T>,
    retries: number,
    url: string,
    nodeType: 'full' | 'archive',
    errorHandler?: (error: any) => T | undefined,
  ): Promise<T> {
    const pRetry = await import('p-retry');
    try {
      // Select the appropriate limit based on node type
      const limit = nodeType === 'full' ? this.fullNodeLimit : this.archiveNodeLimit;
      return await limit(() =>
        pRetry.default(() => callEndpoint(url), {
          retries,
          minTimeout: 50, // Use much shorter timeout for tests
          onFailedAttempt: async (error: { attemptNumber: number }) => {
            const delay = this.calculateBackoffDelay(error.attemptNumber);
            await new Promise((resolve) => setTimeout(resolve, delay));
          },
        }),
      );
    } catch (error) {
      // Try to handle the error if handler provided
      if (errorHandler) {
        const handled = errorHandler(error);
        if (handled !== undefined) {
          return handled;
        }
      }

      throw error;
    }
  }
}
