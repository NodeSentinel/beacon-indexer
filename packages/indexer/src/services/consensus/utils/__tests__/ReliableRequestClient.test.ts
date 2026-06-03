import ms from 'ms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestReliableClient } from '@/src/services/consensus/utils/__tests__/reliableClient.js';

// Mock fetch globally
global.fetch = vi.fn();

/**
 * Helper function to create a mock fetch with configurable timeout
 * @param timeout - Delay in milliseconds before resolving (default: 10ms)
 * @param responseText - Text to return in response (default: 'Response')
 * @returns Mock fetch function
 */
function createMockFetch(timeout = 10, responseText = 'Response') {
  return vi.fn().mockImplementation(() => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ok: true,
          text: () => Promise.resolve(responseText),
        });
      }, timeout);
    });
  });
}

describe('ReliableRequestClient', () => {
  let client: TestReliableClient;
  const fullNodeUrl = 'https://full.example.com';
  const archiveNodeUrl = 'https://archive.example.com';

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TestReliableClient({
      fullNodeConcurrency: 10,
      archiveNodeConcurrency: 5,
      fullNodeUrl,
      archiveNodeUrl,
      baseDelay: ms('1ms'), // Use very short delays for tests
      fullNodeRetries: 1, // Only 1 retry for full node
      archiveNodeRetries: 2, // Only 2 retries for archive node
    });
  });

  afterEach(() => {
    client.clearQueue();
  });

  describe('reliable request with full and archive node types', () => {
    it('should create full node request and work successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('Full node success'),
      });

      global.fetch = mockFetch;

      const result = await client.method1Full();

      expect(result).toBe('Full node success');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(`${fullNodeUrl}/test`);
    });

    // This test verifies a full-priority request uses the second full attempt before falling
    // back to archive, matching the indexer's preferred full-node recovery order.
    it('tries full again after the first failed full-node attempt', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve('Full node success after retry'),
        });
      const delaySpy = vi.spyOn(
        client as unknown as { calculateBackoffDelay: (attempt: number) => number },
        'calculateBackoffDelay',
      );

      // This setup makes the first full-node request fail and the second full-node request
      // succeed, so the test exercises exactly one retry delay.
      global.fetch = mockFetch;

      // Running the request should retry on the full node before any archive fallback happens.
      const result = await client.method1Full();

      // The request should return the second full-node response after the configured retry.
      expect(result).toBe('Full node success after retry');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(1, `${fullNodeUrl}/test`);
      expect(mockFetch).toHaveBeenNthCalledWith(2, `${fullNodeUrl}/test`);

      // The single full-node failure should use the first Fibonacci backoff attempt.
      expect(delaySpy.mock.calls.map(([attempt]) => attempt)).toEqual([1]);
    });

    it('should create archive node request and work successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('Archive node success'),
      });

      global.fetch = mockFetch;

      const result = await client.method1Archive();

      expect(result).toBe('Archive node success');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(`${archiveNodeUrl}/test`);
    });

    // This test verifies archive-priority requests retry the archive node according to the
    // configured retry count before the request succeeds.
    it('should create archive node request, fail, do backoff 2 times, then work', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockRejectedValueOnce(new Error('Second attempt failed'))
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve('Archive node success after retries'),
        });

      global.fetch = mockFetch;

      const startTime = Date.now();
      const result = await client.method1Archive();
      const endTime = Date.now();

      expect(result).toBe('Archive node success after retries');
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenNthCalledWith(1, `${archiveNodeUrl}/test`);
      expect(mockFetch).toHaveBeenNthCalledWith(2, `${archiveNodeUrl}/test`);
      expect(mockFetch).toHaveBeenNthCalledWith(3, `${archiveNodeUrl}/test`);

      // Verify that Fibonacci backoff was applied (at least 1ms + 2ms = 3ms total).
      expect(endTime - startTime).toBeGreaterThanOrEqual(3);
    });

    // This test verifies full-priority requests exhaust two full attempts before trying the
    // archive node three times, then return the successful archive response.
    it('tries full twice then archive three times for full-priority requests', async () => {
      const alternatingClient = new TestReliableClient({
        fullNodeConcurrency: 10,
        archiveNodeConcurrency: 5,
        fullNodeUrl,
        archiveNodeUrl,
        baseDelay: ms('1ms'),
        fullNodeRetries: 1,
        archiveNodeRetries: 2,
      });
      const mockFetch = vi.fn();

      // The first four failures force full/full/archive/archive before the final archive success.
      for (let i = 0; i < 4; i++) {
        mockFetch.mockRejectedValueOnce(new Error('Beacon node failed'));
      }

      // The fifth attempt succeeds on archive, proving the final fallback is reached.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('Final archive fallback success'),
      });

      global.fetch = mockFetch;

      const result = await alternatingClient.method1Full();

      expect(result).toBe('Final archive fallback success');
      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(mockFetch).toHaveBeenNthCalledWith(1, `${fullNodeUrl}/test`);
      expect(mockFetch).toHaveBeenNthCalledWith(2, `${fullNodeUrl}/test`);
      expect(mockFetch).toHaveBeenNthCalledWith(3, `${archiveNodeUrl}/test`);
      expect(mockFetch).toHaveBeenNthCalledWith(4, `${archiveNodeUrl}/test`);
      expect(mockFetch).toHaveBeenNthCalledWith(5, `${archiveNodeUrl}/test`);
    });

    // This test verifies archive-priority requests can make five archive attempts when the
    // configured retry count allows four retries after the first attempt.
    it('tries archive up to five times for archive-priority requests', async () => {
      const archiveClient = new TestReliableClient({
        fullNodeConcurrency: 10,
        archiveNodeConcurrency: 5,
        fullNodeUrl,
        archiveNodeUrl,
        baseDelay: ms('1ms'),
        fullNodeRetries: 2,
        archiveNodeRetries: 4,
      });
      const mockFetch = vi.fn();

      // Four failures force every retry slot before the fifth archive attempt succeeds.
      for (let i = 0; i < 4; i++) {
        mockFetch.mockRejectedValueOnce(new Error('Archive node failed'));
      }

      // The fifth archive request succeeds and should be the final network call.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('Fifth archive attempt success'),
      });

      global.fetch = mockFetch;

      const result = await archiveClient.method1Archive();

      expect(result).toBe('Fifth archive attempt success');
      expect(mockFetch).toHaveBeenCalledTimes(5);
      for (let callNumber = 1; callNumber <= 5; callNumber++) {
        expect(mockFetch).toHaveBeenNthCalledWith(callNumber, `${archiveNodeUrl}/test`);
      }
    });

    // This test verifies the retry backoff uses the requested Fibonacci delay sequence.
    it('uses fibonacci backoff delays for failed attempts', () => {
      // With a 1ms base delay, each failed attempt maps directly to the expected delay.
      expect([1, 2, 3, 4, 5].map((attempt) => client.delayForAttempt(attempt))).toEqual([
        ms('1ms'),
        ms('2ms'),
        ms('3ms'),
        ms('5ms'),
        ms('8ms'),
      ]);
    });

    // This test verifies a full-priority request restarts the backoff progression when it
    // falls back from the full node to the archive node after exhausting full-node attempts.
    it('resets fibonacci backoff attempts when falling back from full to archive', async () => {
      const fallbackClient = new TestReliableClient({
        fullNodeConcurrency: 10,
        archiveNodeConcurrency: 5,
        fullNodeUrl,
        archiveNodeUrl,
        baseDelay: ms('1ms'),
        fullNodeRetries: 1,
        archiveNodeRetries: 2,
      });
      const mockFetch = vi.fn();
      const delaySpy = vi.spyOn(
        fallbackClient as unknown as { calculateBackoffDelay: (attempt: number) => number },
        'calculateBackoffDelay',
      );

      // The first two failures exhaust the full node, and the next two failures exercise
      // archive-node retry delays before the final archive attempt succeeds.
      for (let i = 0; i < 4; i++) {
        mockFetch.mockRejectedValueOnce(new Error('Beacon node failed'));
      }

      // The final response proves the request reached the last archive attempt after retries.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('Archive fallback success'),
      });

      // This setup sends the request through full/full/archive/archive/archive.
      global.fetch = mockFetch;

      // Running the request should calculate two full-node delays and then restart the archive
      // delay progression from the first Fibonacci step.
      const result = await fallbackClient.method1Full();

      // The request should still resolve from archive after all planned failures.
      expect(result).toBe('Archive fallback success');

      // Full-node failures use attempts 1 and 2; archive-node failures must restart at 1 and 2.
      expect(delaySpy.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 1, 2]);
    });
  });

  describe('concurrency control methods', () => {
    it('should not exceed the concurrency limit for full nodes', async () => {
      const fullConcurrency = 2;
      const client = new TestReliableClient({
        fullNodeConcurrency: fullConcurrency,
        archiveNodeConcurrency: 1,
        fullNodeUrl,
        archiveNodeUrl,
        baseDelay: ms('1ms'),
        fullNodeRetries: 1,
        archiveNodeRetries: 2,
      });

      // Mock fetch to simulate slow requests
      const mockFetch = createMockFetch(10, 'Response');
      global.fetch = mockFetch;

      // Start 4 concurrent requests (more than the limit of 2)
      const promises = Array.from({ length: 4 }, () => client.method1Full());

      // Check concurrency stats while requests are running
      const stats = client.getConcurrencyStats();
      expect(stats.fullNode.concurrency).toBe(fullConcurrency);
      expect(stats.fullNode.activeCount).toBeLessThanOrEqual(fullConcurrency);
      expect(stats.fullNode.pendingCount).toBeGreaterThanOrEqual(0);

      // Wait for all requests to complete
      const results = await Promise.all(promises);

      // Verify all requests completed successfully
      expect(results).toHaveLength(4);
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Verify final state
      const finalStats = client.getConcurrencyStats();
      expect(finalStats.fullNode.activeCount).toBe(0);
      expect(finalStats.fullNode.pendingCount).toBe(0);
    }, 5000); // 5 second timeout

    it('should not exceed the concurrency limit for archive nodes', async () => {
      const archiveConcurrency = 3;
      const client = new TestReliableClient({
        fullNodeConcurrency: 10,
        archiveNodeConcurrency: archiveConcurrency,
        fullNodeUrl,
        archiveNodeUrl,
        baseDelay: ms('1ms'),
        fullNodeRetries: 1,
        archiveNodeRetries: 2,
      });

      // Mock fetch to simulate slow requests
      const mockFetch = createMockFetch(10, 'Archive Response');
      global.fetch = mockFetch;

      // Start 5 concurrent archive requests (more than the limit of 3)
      const promises = Array.from({ length: 5 }, () => client.method1Archive());

      // Check concurrency stats while requests are running
      const stats = client.getConcurrencyStats();
      expect(stats.archiveNode.concurrency).toBe(archiveConcurrency);
      expect(stats.archiveNode.activeCount).toBeLessThanOrEqual(archiveConcurrency);
      expect(stats.archiveNode.pendingCount).toBeGreaterThanOrEqual(0);

      // Wait for all requests to complete
      const results = await Promise.all(promises);

      // Verify all requests completed successfully
      expect(results).toHaveLength(5);
      expect(mockFetch).toHaveBeenCalledTimes(5);

      // Verify final state
      const finalStats = client.getConcurrencyStats();
      expect(finalStats.archiveNode.activeCount).toBe(0);
      expect(finalStats.archiveNode.pendingCount).toBe(0);
    }, 5000); // 5 second timeout

    it('should respect independent limits when sending mixed requests (full/archive)', async () => {
      const fullConcurrency = 2;
      const archiveConcurrency = 3;
      const client = new TestReliableClient({
        fullNodeConcurrency: fullConcurrency,
        archiveNodeConcurrency: archiveConcurrency,
        fullNodeUrl,
        archiveNodeUrl,
        baseDelay: ms('1ms'),
        fullNodeRetries: 1,
        archiveNodeRetries: 2,
      });

      // Mock fetch to simulate slow requests
      const mockFetch = createMockFetch(10, 'Mixed Response');
      global.fetch = mockFetch;

      // Start mixed requests: 4 full + 5 archive (exceeding both limits)
      const fullPromises = Array.from({ length: 4 }, () => client.method1Full());
      const archivePromises = Array.from({ length: 5 }, () => client.method1Archive());
      const allPromises = [...fullPromises, ...archivePromises];

      // Check concurrency stats while requests are running
      const stats = client.getConcurrencyStats();

      // Verify full node limits
      expect(stats.fullNode.concurrency).toBe(fullConcurrency);
      expect(stats.fullNode.activeCount).toBeLessThanOrEqual(fullConcurrency);
      expect(stats.fullNode.pendingCount).toBeGreaterThanOrEqual(0);

      // Verify archive node limits
      expect(stats.archiveNode.concurrency).toBe(archiveConcurrency);
      expect(stats.archiveNode.activeCount).toBeLessThanOrEqual(archiveConcurrency);
      expect(stats.archiveNode.pendingCount).toBeGreaterThanOrEqual(0);

      // Wait for all requests to complete
      const results = await Promise.all(allPromises);

      // Verify all requests completed successfully
      expect(results).toHaveLength(9);
      expect(mockFetch).toHaveBeenCalledTimes(9);

      // Verify final state
      const finalStats = client.getConcurrencyStats();
      expect(finalStats.fullNode.activeCount).toBe(0);
      expect(finalStats.fullNode.pendingCount).toBe(0);
      expect(finalStats.archiveNode.activeCount).toBe(0);
      expect(finalStats.archiveNode.pendingCount).toBe(0);
    }, 5000); // 5 second timeout
  });
});
