import axios, { AxiosError } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BeaconClient } from './beacon.js';

// This suite verifies request caching behavior for slow beacon reward endpoints.
describe('BeaconClient reward cache', () => {
  afterEach(() => {
    // Restore spies so each test controls the HTTP client path it observes.
    vi.restoreAllMocks();
  });

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

    // This spy verifies normal processing does not issue its own configured-node request.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const normalGetSpy = vi.spyOn(axiosInstance, 'get' as never);

    // This spy resolves the dedicated prefetch request without depending on its temporary base URL.
    const prefetchGetSpy = vi.spyOn(axios, 'get' as never).mockResolvedValue({
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

    // This assertion verifies the prefetch path made the rewards request.
    expect(prefetchGetSpy).toHaveBeenCalledTimes(1);

    // This assertion verifies normal processing joined the in-flight prefetch instead of fetching again.
    expect(normalGetSpy).not.toHaveBeenCalled();
  });

  // This test verifies failed block reward prefetches do not poison normal processing.
  it('fetches block rewards normally after a failed prefetch request', async () => {
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

    // This error simulates an auth failure from the temporary prefetch endpoint.
    const prefetchError = new AxiosError('Request failed with status code 401');
    prefetchError.response = {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config: {} as never,
      data: { message: 'Unauthorized' },
    };

    // This spy makes the dedicated prefetch endpoint fail.
    const prefetchGetSpy = vi.spyOn(axios, 'get' as never).mockRejectedValue(prefetchError);

    // This spy makes the configured normal endpoint succeed after prefetch failure.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const normalGetSpy = vi.spyOn(axiosInstance, 'get' as never).mockResolvedValue({
      data: {
        data: {
          proposer_index: '1',
          total: '10',
        },
      },
    } as never);

    // This call starts a fire-and-forget prefetch that should fail silently.
    beaconClient.prefetchBlockRewards(1);

    // This wait confirms the prefetch request reached the temporary endpoint.
    await vi.waitFor(() => expect(prefetchGetSpy).toHaveBeenCalledTimes(1));

    // This tick lets the rejected prefetch promise settle before normal processing starts.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // This normal call must use the configured node and not read a failed cache entry.
    const result = await beaconClient.getBlockRewards(1);

    // This assertion verifies normal processing receives the configured endpoint response.
    expect(result).toEqual({
      data: {
        proposer_index: '1',
        total: '10',
      },
    });

    // This assertion verifies normal processing made a fresh configured-node request.
    expect(normalGetSpy).toHaveBeenCalledTimes(1);
  });

  // This test verifies prefetching committees warms the cache for normal processing.
  it('serves committees from a prefetched request', async () => {
    // This client exercises the committee prefetch cache path.
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

    // This spy verifies normal processing shares the configured-node prefetch request.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const getSpy = vi
      .spyOn(axiosInstance, 'get' as never)
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              index: '0',
              slot: '64',
              validators: ['1'],
            },
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              index: '1',
              slot: '64',
              validators: ['2'],
            },
          ],
        },
      } as never);

    // This call starts the request before the epoch reaches normal processing.
    beaconClient.prefetchCommittees(2, 64);

    // This normal processing call should reuse the prefetched request result.
    const result = await beaconClient.getCommittees(2, 64);

    // This assertion verifies normal processing receives the prefetched endpoint result.
    expect(result).toEqual([
      {
        index: '0',
        slot: '64',
        validators: ['1'],
      },
    ]);

    // This assertion verifies normal processing joined the prefetch instead of fetching again.
    expect(getSpy).toHaveBeenCalledTimes(1);

    // This second normal call verifies consumed committee entries are removed from cache.
    const secondResult = await beaconClient.getCommittees(2, 64);

    // This assertion verifies a fresh request is made after the consumed entry is deleted.
    expect(secondResult).toEqual([
      {
        index: '1',
        slot: '64',
        validators: ['2'],
      },
    ]);

    // This assertion verifies the deleted entry was not reused after consumption.
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  // This test verifies failed committee prefetches do not poison normal processing.
  it('fetches committees normally after a failed prefetch request', async () => {
    // This client exercises the normal committee path after a failed prefetch.
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

    // This error simulates an auth failure from the dedicated prefetch endpoint.
    const prefetchError = new AxiosError('Request failed with status code 401');
    prefetchError.response = {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config: {} as never,
      data: { message: 'Unauthorized' },
    };

    // This spy makes prefetch fail and the next normal endpoint call succeed.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const getSpy = vi
      .spyOn(axiosInstance, 'get' as never)
      .mockRejectedValueOnce(prefetchError)
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              index: '0',
              slot: '64',
              validators: ['1'],
            },
          ],
        },
      } as never);

    // This call starts a fire-and-forget prefetch that should fail silently.
    beaconClient.prefetchCommittees(2, 64);

    // This wait confirms the prefetch request reached the temporary endpoint.
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));

    // This tick lets the rejected prefetch promise settle before normal processing starts.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // This normal call must use the configured node and not read a failed cache entry.
    const result = await beaconClient.getCommittees(2, 64);

    // This assertion verifies normal processing receives the configured endpoint response.
    expect(result).toEqual([
      {
        index: '0',
        slot: '64',
        validators: ['1'],
      },
    ]);

    // This assertion verifies normal processing made a fresh configured-node request.
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  // This test verifies normal processing retries when it joins a failed committee prefetch.
  it('fetches committees normally after joining an in-flight failed prefetch', async () => {
    // This client exercises the coalescing path for committee prefetch failures.
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

    // This error simulates a failed prefetch request.
    const prefetchError = new AxiosError('Request failed with status code 500');
    prefetchError.response = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      config: {} as never,
      data: { message: 'Internal Server Error' },
    };

    // This deferred rejection keeps the prefetch request in flight.
    let rejectPrefetchResponse: (error: unknown) => void;
    const prefetchResponsePromise = new Promise((_resolve, reject) => {
      rejectPrefetchResponse = reject;
    });

    // This spy makes the in-flight prefetch fail and the retry succeed.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const getSpy = vi
      .spyOn(axiosInstance, 'get' as never)
      .mockReturnValueOnce(prefetchResponsePromise as never)
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              index: '0',
              slot: '64',
              validators: ['1'],
            },
          ],
        },
      } as never);

    // This call starts a prefetch request that normal processing will join.
    beaconClient.prefetchCommittees(2, 64);

    // This wait confirms the prefetch request is in flight.
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));

    // This normal call joins the in-flight prefetch.
    const committeesPromise = beaconClient.getCommittees(2, 64);

    // This rejection makes the joined prefetch return no cache value.
    rejectPrefetchResponse!(prefetchError);

    // This assertion verifies normal processing retries and receives fresh committees.
    await expect(committeesPromise).resolves.toEqual([
      {
        index: '0',
        slot: '64',
        validators: ['1'],
      },
    ]);

    // This assertion verifies the retry made a second configured-node request.
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  // This test verifies committee prefetch is skipped when the indexer is not delayed.
  it('does not prefetch committees when the indexer is not delayed', () => {
    // This client exercises the delayed guard in committee prefetching.
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

    // This spy forces the prefetch delayed check to behave like the indexer is near head.
    vi.spyOn(
      beaconClient as unknown as {
        isIndexerDelayed: (input: { value: number; type: 'slot' | 'epoch' }) => boolean;
      },
      'isIndexerDelayed',
    ).mockReturnValue(false);

    // This spy verifies no configured-node request is started.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const getSpy = vi.spyOn(axiosInstance, 'get' as never);

    // This call should return before touching the cache or network.
    beaconClient.prefetchCommittees(2, 64);

    // This assertion verifies no prefetch request was made near head.
    expect(getSpy).not.toHaveBeenCalled();
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

    // This spy makes every dedicated prefetch attempt receive the failed response.
    const postSpy = vi.spyOn(axios, 'post' as never).mockRejectedValue(prefetchError);

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

    // This spy verifies normal processing does not issue its own configured-node request.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const normalPostSpy = vi.spyOn(axiosInstance, 'post' as never);

    // This spy returns the same delayed prefetch response to expose duplicate requests.
    const prefetchPostSpy = vi.spyOn(axios, 'post' as never).mockReturnValue(responsePromise);

    // This call starts the prefetch request for the slot and validators.
    beaconClient.prefetchSyncCommitteeRewards(1, ['1']);

    // This wait confirms the prefetch request is in flight before normal processing starts.
    await vi.waitFor(() => expect(prefetchPostSpy).toHaveBeenCalledTimes(1));

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
    expect(prefetchPostSpy).toHaveBeenCalledTimes(1);

    // This assertion verifies normal processing joined the in-flight prefetch instead of fetching again.
    expect(normalPostSpy).not.toHaveBeenCalled();
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

    // This spy makes the dedicated prefetch request receive 404.
    const prefetchPostSpy = vi
      .spyOn(axios, 'post' as never)
      .mockReturnValueOnce(prefetchResponsePromise as never);

    // This spy makes normal processing receive rewards from the configured endpoint later.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const normalPostSpy = vi.spyOn(axiosInstance, 'post' as never).mockResolvedValue({
      data: {
        data: [{ validator_index: '1', reward: '10' }],
        execution_optimistic: false,
        finalized: true,
      },
    } as never);

    // This call starts a prefetch that should stop on 404 without filling the cache.
    beaconClient.prefetchSyncCommitteeRewards(1, ['1']);

    // This wait confirms the prefetch request is in flight before normal processing starts.
    await vi.waitFor(() => expect(prefetchPostSpy).toHaveBeenCalledTimes(1));

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

    // This assertion verifies normal processing made a configured-node request after prefetch 404.
    expect(normalPostSpy).toHaveBeenCalledTimes(1);
  });
});
