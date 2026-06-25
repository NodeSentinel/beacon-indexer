import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecutionLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@/src/lib/pino.js', () => ({
  default: vi.fn(() => mockExecutionLogger),
}));

import { ExecutionClient } from '@/src/services/execution/execution.js';

// This test suite verifies the generic execution RPC reward calculation and fallback strategy.
describe('ExecutionClient', () => {
  // This block creates a client with main and backup RPC URLs for each test.
  let executionClient: ExecutionClient;

  // This hook resets mocks and creates a clean execution client before each test.
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
    executionClient = new ExecutionClient({
      mainExecutionRpc: 'http://main-rpc',
      bkpExecutionRpc: 'http://bkp-rpc',
      requestsPerSecond: 3,
    });
  });

  // This hook restores fake timers if a test exits before its local cleanup runs.
  afterEach(() => {
    vi.useRealTimers();
  });

  // This test verifies that getBlock calculates the fee recipient reward from JSON-RPC data.
  it('calculates block priority fees from a generic execution RPC response', async () => {
    // This response provides one block and two receipts with EIP-1559 fee data.
    const rpcBatchResponse = [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          number: '0xa',
          timestamp: '0x64',
          miner: '0xfeeRecipient',
          baseFeePerGas: '0xa',
        },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        result: [
          { gasUsed: '0x5208', effectiveGasPrice: '0xf' },
          { gasUsed: '0x10', effectiveGasPrice: '0xc' },
        ],
      },
    ];

    // This spy returns the batch response from the main RPC endpoint.
    const axiosInstance = (executionClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi
      .spyOn(axiosInstance, 'post' as never)
      .mockResolvedValueOnce({ data: rpcBatchResponse } as never);

    // This call exercises the full getBlock JSON-RPC parsing and reward calculation path.
    const block = await executionClient.getBlock(10);

    // This assertion verifies the execution reward is the sum of positive priority fees.
    expect(block).toEqual({
      address: '0xfeeRecipient',
      timestamp: new Date(100_000),
      amount: '105032',
      blockNumber: 10,
    });

    // This assertion verifies the generic RPC URL is called directly without provider-specific keys.
    expect(postSpy.mock.calls[0]?.[0]).toBe('http://main-rpc');
  });

  // This test verifies that JSON-RPC batch responses are matched by response id, not array order.
  it('matches JSON-RPC batch responses by id when the RPC returns them out of order', async () => {
    // This response intentionally returns receipts before the block response.
    const rpcBatchResponse = [
      {
        jsonrpc: '2.0',
        id: 2,
        result: [{ gasUsed: '0x1', effectiveGasPrice: '0xb' }],
      },
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          number: '0xa',
          timestamp: '0x64',
          miner: '0xfeeRecipient',
          baseFeePerGas: '0xa',
        },
      },
    ];

    // This spy returns the out-of-order batch from the main RPC endpoint.
    const axiosInstance = (executionClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    vi.spyOn(axiosInstance, 'post' as never).mockResolvedValueOnce({
      data: rpcBatchResponse,
    } as never);

    // This call verifies the client uses response ids to find the block and receipts.
    await expect(executionClient.getBlock(10)).resolves.toMatchObject({
      address: '0xfeeRecipient',
      amount: '1',
      blockNumber: 10,
    });
  });

  // This test verifies that waiting retries do not hold the RPC concurrency limiter.
  it('does not hold a concurrency slot while a failed block waits before retrying', async () => {
    // This client has one RPC slot so a sleeping retry would block all other blocks.
    executionClient = new ExecutionClient({
      mainExecutionRpc: 'http://main-rpc',
      bkpExecutionRpc: 'http://bkp-rpc',
      requestsPerSecond: 1,
    });

    // This fake timer lets the test pause the first request during its backoff delay.
    vi.useFakeTimers();

    // This successful response is returned for the second block while the first block waits.
    const successResponse = [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          number: '0xb',
          timestamp: '0x64',
          miner: '0xfeeRecipient',
          baseFeePerGas: '0xa',
        },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        result: [{ gasUsed: '0x1', effectiveGasPrice: '0xb' }],
      },
    ];

    // This spy fails block 10 but succeeds for block 11.
    const axiosInstance = (executionClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi.spyOn(axiosInstance, 'post' as never).mockImplementation(((
      url: string,
      body: Array<{ params: string[] }>,
    ) => {
      const requestedBlock = body[0]?.params[0];
      if (requestedBlock === '0xb') {
        return Promise.resolve({ data: successResponse });
      }
      return Promise.reject(new Error(`failed ${url}`));
    }) as never);

    // This request fails against main and backup, then waits before retrying.
    const failedBlockPromise = executionClient.getBlock(10).catch((error: unknown) => error);

    // This timer advance lets the first request enter its first backoff delay.
    await vi.advanceTimersByTimeAsync(0);

    // This request should use the free RPC slot while the first request is sleeping.
    const successfulBlockPromise = executionClient.getBlock(11);

    // This timer advance lets the second request make its network call.
    await vi.advanceTimersByTimeAsync(0);

    // This assertion proves the second block was not blocked by the first block's sleep.
    await expect(successfulBlockPromise).resolves.toMatchObject({
      address: '0xfeeRecipient',
      amount: '1',
      blockNumber: 11,
    });

    // This assertion verifies that the second request reached the RPC during the first backoff.
    expect(postSpy.mock.calls.map((call) => call[0])).toContain('http://main-rpc');
    expect(postSpy.mock.calls).toHaveLength(3);

    // This timer advance lets the failed first block exhaust its retry cycles.
    await vi.advanceTimersByTimeAsync(100 + 200 + 400 + 800);
    const failedBlockError = await failedBlockPromise;
    expect(failedBlockError).toBeInstanceOf(Error);
    expect((failedBlockError as Error).message).toContain('[BKP] failed for block 10');

    // This cleanup restores real timers for the rest of the test process.
    vi.useRealTimers();
  });

  // This test verifies that getBlock tries main then backup as a pair before each backoff delay.
  it('tries main then backup for each retry cycle before waiting with exponential backoff', async () => {
    // This response succeeds on the final backup attempt.
    const successResponse = [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          number: '0xa',
          timestamp: '0x64',
          miner: '0xfeeRecipient',
          baseFeePerGas: '0xa',
        },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        result: [{ gasUsed: '0x1', effectiveGasPrice: '0xb' }],
      },
    ];

    // This fake timer lets the test assert backoff without waiting in real time.
    vi.useFakeTimers();

    // This spy fails two complete main/backup cycles, then succeeds on backup in cycle three.
    const axiosInstance = (executionClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi
      .spyOn(axiosInstance, 'post' as never)
      .mockRejectedValueOnce(new Error('main cycle 1') as never)
      .mockRejectedValueOnce(new Error('bkp cycle 1') as never)
      .mockRejectedValueOnce(new Error('main cycle 2') as never)
      .mockRejectedValueOnce(new Error('bkp cycle 2') as never)
      .mockRejectedValueOnce(new Error('main cycle 3') as never)
      .mockResolvedValueOnce({ data: successResponse } as never);

    // This promise starts the retry sequence while fake timers control the delays.
    const blockPromise = executionClient.getBlock(10);

    // This microtask flush lets the first main/backup pair fail and schedule the 100ms delay.
    await vi.advanceTimersByTimeAsync(100);

    // This timer advance lets the second main/backup pair fail and schedule the 200ms delay.
    await vi.advanceTimersByTimeAsync(200);

    // This assertion verifies the final backup attempt returns the successful block response.
    await expect(blockPromise).resolves.toMatchObject({
      address: '0xfeeRecipient',
      amount: '1',
    });

    // This assertion verifies the endpoint order is main, backup for each retry cycle.
    expect(postSpy.mock.calls.map((call) => call[0])).toEqual([
      'http://main-rpc',
      'http://bkp-rpc',
      'http://main-rpc',
      'http://bkp-rpc',
      'http://main-rpc',
      'http://bkp-rpc',
    ]);

    // This cleanup restores real timers for the rest of the test process.
    vi.useRealTimers();
  });

  // This test verifies every failed execution endpoint attempt is visible in logs.
  it('logs each failed execution RPC endpoint attempt with block and retry context', async () => {
    // This successful response arrives after both endpoints fail in the first cycle.
    const successResponse = [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          number: '0xa',
          timestamp: '0x64',
          miner: '0xfeeRecipient',
          baseFeePerGas: '0xa',
        },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        result: [{ gasUsed: '0x1', effectiveGasPrice: '0xb' }],
      },
    ];

    // This spy simulates a main RPC failure, then a backup RPC failure, then recovery.
    const axiosInstance = (executionClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    vi.spyOn(axiosInstance, 'post' as never)
      .mockRejectedValueOnce(new Error('main dns failure') as never)
      .mockRejectedValueOnce(new Error('backup dns failure') as never)
      .mockResolvedValueOnce({ data: successResponse } as never);

    // This call exercises the retry loop until the second cycle succeeds.
    await expect(executionClient.getBlock(10)).resolves.toMatchObject({
      address: '0xfeeRecipient',
      amount: '1',
      blockNumber: 10,
    });

    // These assertions make sure both failed endpoints are logged with enough
    // context to reconstruct fallback order for a stuck slot investigation.
    expect(mockExecutionLogger.error).toHaveBeenNthCalledWith(1, 'Execution RPC attempt failed', {
      attempt: 1,
      blockNumber: 10,
      endpoint: 'MAIN',
      error: 'main dns failure',
      maxAttempts: 5,
      url: 'http://main-rpc',
    });
    expect(mockExecutionLogger.error).toHaveBeenNthCalledWith(2, 'Execution RPC attempt failed', {
      attempt: 1,
      blockNumber: 10,
      endpoint: 'BKP',
      error: 'backup dns failure',
      maxAttempts: 5,
      url: 'http://bkp-rpc',
    });
  });
});
