import ms from 'ms';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

    it('should create full node request, fail, do exponential backoff 1 time, then work', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve('Full node success after retries'),
        });

      global.fetch = mockFetch;

      const startTime = Date.now();
      const result = await client.method1Full();
      const endTime = Date.now();

      expect(result).toBe('Full node success after retries');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(1, `${fullNodeUrl}/test`);
      expect(mockFetch).toHaveBeenNthCalledWith(2, `${fullNodeUrl}/test`);

      // Verify that exponential backoff was applied (at least 1ms)
      expect(endTime - startTime).toBeGreaterThan(1);
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

    it('should create archive node request, fail, do exponential backoff 2 times, then work', async () => {
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

      // Verify that exponential backoff was applied (at least 1ms + 2ms = 3ms total)
      expect(endTime - startTime).toBeGreaterThan(3);
    });

    it('should exhaust full nodes with backoff and fallback to archive', async () => {
      // Mock fetch to fail all full node attempts (1 retry) and succeed on archive
      const mockFetch = vi.fn();

      // First 2 calls to full node fail (1 retry + 1 initial attempt)
      for (let i = 0; i < 2; i++) {
        mockFetch.mockRejectedValueOnce(new Error('Full node failed'));
      }

      // 3rd call to archive succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('Archive fallback success'),
      });

      global.fetch = mockFetch;

      const startTime = Date.now();
      const result = await client.method1Full();
      const endTime = Date.now();

      expect(result).toBe('Archive fallback success');
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // First 2 calls should be to full node
      for (let i = 1; i <= 2; i++) {
        expect(mockFetch).toHaveBeenNthCalledWith(i, `${fullNodeUrl}/test`);
      }
      // 3rd call should be to archive node
      expect(mockFetch).toHaveBeenNthCalledWith(3, `${archiveNodeUrl}/test`);

      // Verify that some time passed due to exponential backoff on full node
      expect(endTime - startTime).toBeGreaterThan(1); // At least 1ms
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
