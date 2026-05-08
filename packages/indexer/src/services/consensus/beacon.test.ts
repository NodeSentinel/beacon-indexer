import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { BeaconClient } from './beacon.js';

// This suite verifies request caching behavior for slow beacon reward endpoints.
describe('BeaconClient reward cache', () => {
  // This test verifies simultaneous block reward reads for one slot share one HTTP request.
  it('coalesces concurrent block reward requests for the same slot', async () => {
    // This client uses a single archive request lane so duplicate requests are easy to observe.
    const beaconClient = new BeaconClient({
      fullNodeUrl: 'http://full-node',
      fullNodeConcurrency: 1,
      fullNodeRetries: 0,
      archiveNodeUrl: 'http://archive-node',
      archiveNodeConcurrency: 1,
      archiveNodeRetries: 0,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This spy resolves the beacon block rewards endpoint with a minimal valid response.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const getSpy = vi.spyOn(axiosInstance, 'get' as never).mockResolvedValue({
      data: {
        data: {
          proposer_index: '1',
          total: '10',
        },
      },
    } as never);

    // These calls simulate processing and prefetch waiting on the same slow slot endpoint.
    const [firstResult, secondResult] = await Promise.all([
      beaconClient.getBlockRewards(1),
      beaconClient.getBlockRewards(1),
    ]);

    // This assertion verifies both callers receive the same endpoint result.
    expect(firstResult).toEqual(secondResult);

    // This assertion verifies only one underlying HTTP request was made for the slot.
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  // This test verifies prefetching a block reward warms the cache for normal processing.
  it('serves block rewards from a prefetched request', async () => {
    // This client is configured far behind head so block reward prefetching is enabled.
    const beaconClient = new BeaconClient({
      fullNodeUrl: 'http://full-node',
      fullNodeConcurrency: 1,
      fullNodeRetries: 0,
      archiveNodeUrl: 'http://archive-node',
      archiveNodeConcurrency: 1,
      archiveNodeRetries: 0,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This spy resolves the prefetched beacon block rewards endpoint.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const getSpy = vi.spyOn(axiosInstance, 'get' as never).mockResolvedValue({
      data: {
        data: {
          proposer_index: '1',
          total: '10',
        },
      },
    } as never);

    // This call starts the request before the slot reaches normal processing.
    beaconClient.prefetchBlockRewards(1);

    // This normal processing call should reuse the prefetched request result.
    const result = await beaconClient.getBlockRewards(1);

    // This assertion verifies normal processing receives the prefetched endpoint result.
    expect(result).toEqual({
      data: {
        proposer_index: '1',
        total: '10',
      },
    });

    // This assertion verifies prefetch and normal processing did not duplicate the HTTP call.
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  // This test verifies simultaneous sync committee reward reads share one HTTP request.
  it('coalesces concurrent sync committee reward requests for the same slot and validators', async () => {
    // This client uses a single archive request lane so duplicate requests are easy to observe.
    const beaconClient = new BeaconClient({
      fullNodeUrl: 'http://full-node',
      fullNodeConcurrency: 1,
      fullNodeRetries: 0,
      archiveNodeUrl: 'http://archive-node',
      archiveNodeConcurrency: 1,
      archiveNodeRetries: 0,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This spy resolves the beacon sync committee rewards endpoint with a minimal response.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi.spyOn(axiosInstance, 'post' as never).mockResolvedValue({
      data: {
        data: [],
      },
    } as never);

    // These calls simulate processing and prefetch waiting on the same slow slot endpoint.
    const [firstResult, secondResult] = await Promise.all([
      beaconClient.getSyncCommitteeRewards(1, ['1', '2']),
      beaconClient.getSyncCommitteeRewards(1, ['1', '2']),
    ]);

    // This assertion verifies both callers receive the same endpoint result.
    expect(firstResult).toEqual(secondResult);

    // This assertion verifies only one underlying HTTP request was made for the slot.
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  // This test verifies sync committee reward cache keys do not depend on validator order.
  it('coalesces sync committee reward requests when validator order differs', async () => {
    // This client exercises the public sync committee rewards cache key builder.
    const beaconClient = new BeaconClient({
      fullNodeUrl: 'http://full-node',
      fullNodeConcurrency: 1,
      fullNodeRetries: 0,
      archiveNodeUrl: 'http://archive-node',
      archiveNodeConcurrency: 1,
      archiveNodeRetries: 0,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This spy resolves the beacon sync committee rewards endpoint with a minimal response.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi.spyOn(axiosInstance, 'post' as never).mockResolvedValue({
      data: {
        data: [],
      },
    } as never);

    // These concurrent calls use the same validators in different orders.
    await Promise.all([
      beaconClient.getSyncCommitteeRewards(1, ['2', '1']),
      beaconClient.getSyncCommitteeRewards(1, ['1', '2']),
    ]);

    // This assertion verifies both calls use one canonical cache entry.
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  // This test verifies sync committee rewards use fresh cache entries by default.
  it('serves sync committee reward cache entries by default', async () => {
    // This client exercises the public sync committee rewards cache behavior.
    const beaconClient = new BeaconClient({
      fullNodeUrl: 'http://full-node',
      fullNodeConcurrency: 1,
      fullNodeRetries: 0,
      archiveNodeUrl: 'http://archive-node',
      archiveNodeConcurrency: 1,
      archiveNodeRetries: 0,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This spy returns different responses so cache reuse and refresh are observable.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi
      .spyOn(axiosInstance, 'post' as never)
      .mockResolvedValueOnce({
        data: {
          data: [{ validator_index: '1', reward: '10' }],
          execution_optimistic: false,
          finalized: true,
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          data: [{ validator_index: '1', reward: '20' }],
          execution_optimistic: false,
          finalized: true,
        },
      } as never);

    // This call fills the cache entry for the slot and validator.
    await beaconClient.getSyncCommitteeRewards(1, ['1']);

    // This call uses the default behavior and should reuse the cached entry.
    const result = await beaconClient.getSyncCommitteeRewards(1, ['1']);

    // This assertion verifies the default call returns the cached endpoint response.
    expect(result).toEqual({
      data: [{ validator_index: '1', reward: '10' }],
      execution_optimistic: false,
      finalized: true,
    });

    // This assertion verifies the cached entry was reused by default.
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  // This test verifies sync committee rewards skip the cache and API when there are no validators.
  it('returns empty sync committee rewards without a request when validators are empty', async () => {
    // This client exercises the public sync committee rewards method.
    const beaconClient = new BeaconClient({
      fullNodeUrl: 'http://full-node',
      fullNodeConcurrency: 1,
      fullNodeRetries: 0,
      archiveNodeUrl: 'http://archive-node',
      archiveNodeConcurrency: 1,
      archiveNodeRetries: 0,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This spy verifies the endpoint is not called for an empty validator list.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi.spyOn(axiosInstance, 'post' as never);

    // This call covers epochs where storage has no sync committee validators.
    const result = await beaconClient.getSyncCommitteeRewards(1, []);

    // This assertion verifies callers still receive the expected empty rewards shape.
    expect(result).toEqual({ data: [], execution_optimistic: false, finalized: true });

    // This assertion verifies no beacon request was made.
    expect(postSpy).not.toHaveBeenCalled();
  });

  // This test verifies sync committee prefetch does not retry failed responses.
  it('does not retry sync committee prefetch errors', async () => {
    // This client is configured far behind head so sync committee prefetching is enabled.
    const beaconClient = new BeaconClient({
      fullNodeUrl: 'http://full-node',
      fullNodeConcurrency: 1,
      fullNodeRetries: 0,
      archiveNodeUrl: 'http://archive-node',
      archiveNodeConcurrency: 1,
      archiveNodeRetries: 1,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This error simulates a failed beacon API response during prefetch.
    const prefetchError = new AxiosError('Request failed with status code 500');
    prefetchError.response = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      config: {} as never,
      data: { message: 'Internal Server Error' },
    };

    // This spy makes every prefetch attempt receive the failed response.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi.spyOn(axiosInstance, 'post' as never).mockRejectedValue(prefetchError);

    // This call starts a prefetch that should stop on error without retrying.
    beaconClient.prefetchSyncCommitteeRewards(1, ['1']);

    // This wait lets the fire-and-forget prefetch make the initial request.
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));

    // This wait covers the retry delay that would run for normal archive requests.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // This assertion verifies prefetch treated the failed response as final.
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  // This test verifies normal processing can join a successful in-flight sync committee prefetch.
  it('coalesces normal sync committee rewards with an in-flight prefetch', async () => {
    // This client is configured far behind head so sync committee prefetching is enabled.
    const beaconClient = new BeaconClient({
      fullNodeUrl: 'http://full-node',
      fullNodeConcurrency: 1,
      fullNodeRetries: 0,
      archiveNodeUrl: 'http://archive-node',
      archiveNodeConcurrency: 1,
      archiveNodeRetries: 0,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This deferred response keeps the prefetch request in flight during normal processing.
    let resolveResponse: (value: unknown) => void;
    const responsePromise = new Promise((resolve) => {
      resolveResponse = resolve;
    });

    // This spy returns the same delayed response to expose duplicate requests.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi.spyOn(axiosInstance, 'post' as never).mockReturnValue(responsePromise);

    // This call starts the prefetch request for the slot and validators.
    beaconClient.prefetchSyncCommitteeRewards(1, ['1']);

    // This wait confirms the prefetch request is in flight before normal processing starts.
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));

    // This call starts normal processing while prefetch is still unresolved.
    const rewardsPromise = beaconClient.getSyncCommitteeRewards(1, ['1']);

    // This response completes the shared request.
    resolveResponse!({
      data: {
        data: [{ validator_index: '1', reward: '10' }],
        execution_optimistic: false,
        finalized: true,
      },
    });

    // This assertion verifies normal processing receives the prefetched response.
    await expect(rewardsPromise).resolves.toEqual({
      data: [{ validator_index: '1', reward: '10' }],
      execution_optimistic: false,
      finalized: true,
    });

    // This assertion verifies prefetch and normal processing shared one HTTP call.
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  // This test verifies normal processing stays strict after an in-flight prefetch 404.
  it('fetches sync committee rewards strictly after an in-flight prefetch 404', async () => {
    // This client is configured far behind head so sync committee prefetching is enabled.
    const beaconClient = new BeaconClient({
      fullNodeUrl: 'http://full-node',
      fullNodeConcurrency: 1,
      fullNodeRetries: 0,
      archiveNodeUrl: 'http://archive-node',
      archiveNodeConcurrency: 1,
      archiveNodeRetries: 0,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This error simulates the beacon API response for rewards on a skipped slot.
    const skippedSlotError = new AxiosError('Request failed with status code 404');
    skippedSlotError.response = {
      status: 404,
      statusText: 'Not Found',
      headers: {},
      config: {} as never,
      data: { message: 'NOT_FOUND: beacon block at slot 1' },
    };

    // This deferred rejection keeps the prefetch request in flight during normal processing.
    let rejectPrefetchResponse: (error: unknown) => void;
    const prefetchResponsePromise = new Promise((_resolve, reject) => {
      rejectPrefetchResponse = reject;
    });

    // This spy makes prefetch receive 404 and normal processing receive rewards later.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi
      .spyOn(axiosInstance, 'post' as never)
      .mockReturnValueOnce(prefetchResponsePromise as never)
      .mockResolvedValueOnce({
        data: {
          data: [{ validator_index: '1', reward: '10' }],
          execution_optimistic: false,
          finalized: true,
        },
      } as never);

    // This call starts a prefetch that should stop on 404 without filling the cache.
    beaconClient.prefetchSyncCommitteeRewards(1, ['1']);

    // This wait confirms the prefetch request is in flight before normal processing starts.
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));

    // This normal processing call starts while prefetch is still unresolved.
    const rewardsPromise = beaconClient.getSyncCommitteeRewards(1, ['1']);

    // This rejection completes the prefetch skipped-slot path.
    rejectPrefetchResponse!(skippedSlotError);

    // This assertion verifies normal processing receives the strict request response.
    await expect(rewardsPromise).resolves.toEqual({
      data: [{ validator_index: '1', reward: '10' }],
      execution_optimistic: false,
      finalized: true,
    });

    // This assertion verifies normal processing made a second HTTP call after prefetch 404.
    expect(postSpy).toHaveBeenCalledTimes(2);
  });
});
