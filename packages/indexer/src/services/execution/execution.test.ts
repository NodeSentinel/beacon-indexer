import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionClient } from '@/src/services/execution/execution.js';

// This test suite verifies the generic execution RPC reward calculation and fallback strategy.
describe('ExecutionClient', () => {
  // This block creates a client with main and backup RPC URLs for each test.
  let executionClient: ExecutionClient;

  // This hook resets mocks and creates a clean execution client before each test.
  beforeEach(() => {
    vi.restoreAllMocks();
    executionClient = new ExecutionClient({
      mainExecutionRpc: 'http://main-rpc',
      bkpExecutionRpc: 'http://bkp-rpc',
      requestsPerSecond: 3,
    });
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
});
