import { ReliableRequestClient } from '@/src/services/consensus/utils/reliableRequestClient.js';

/**
 * Test class that inherits from ReliableRequestClient for testing purposes
 * Overrides the callAPI method to use shorter timeouts for faster tests
 */
export class TestReliableClient extends ReliableRequestClient {
  constructor({
    archiveNodeConcurrency,
    archiveNodeRetries = 5,
    archiveNodeUrl,
    baseDelay,
    fullNodeConcurrency,
    fullNodeRetries = 3,
    fullNodeUrl,
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
   * Expose retry delay calculation so tests can verify the production backoff sequence.
   */
  delayForAttempt(attempt: number): number {
    return this.calculateBackoffDelay(attempt);
  }
}
