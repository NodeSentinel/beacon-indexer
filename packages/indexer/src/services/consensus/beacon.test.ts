import { AxiosError } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BeaconClient } from './beacon.js';

// This suite verifies request caching behavior for slow beacon reward endpoints.
describe('BeaconClient reward cache', () => {
  afterEach(() => {
    // Restore spies so each test controls the HTTP client path it observes.
    vi.restoreAllMocks();
  });

  // This test verifies simultaneous block reward reads do not use the prefetch cache as a request cache.
  it('fetches concurrent block reward requests independently', async () => {
    // This client uses a single archive request lane so direct duplicate requests are easy to observe.
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

    // These calls simulate two normal processing reads without a completed prefetched value.
    const [firstResult, secondResult] = await Promise.all([
      beaconClient.getBlockRewards(1),
      beaconClient.getBlockRewards(1),
    ]);

    // This assertion verifies both callers still receive the endpoint result shape.
    expect(firstResult).toEqual(secondResult);

    // This assertion verifies normal reads do not coalesce through the prefetch cache.
    expect(getSpy).toHaveBeenCalledTimes(2);
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

    // This spy returns different responses so one-shot consumption is observable.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const getSpy = vi
      .spyOn(axiosInstance, 'get' as never)
      .mockResolvedValueOnce({
        data: {
          data: {
            proposer_index: '1',
            total: '10',
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          data: {
            proposer_index: '1',
            total: '20',
          },
        },
      } as never);

    // This call starts the request before the slot reaches normal processing.
    beaconClient.prefetchBlockRewards(1);

    // This wait confirms the prefetched response has completed and exists as a cache entry.
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // This normal processing call should consume the completed prefetched result.
    const result = await beaconClient.getBlockRewards(1);

    // This assertion verifies normal processing receives the prefetched endpoint result.
    expect(result).toEqual({
      data: {
        proposer_index: '1',
        total: '10',
      },
    });

    // This assertion verifies the configured archive node served the prefetch request.
    expect(getSpy).toHaveBeenCalledWith(
      'http://archive-node/eth/v1/beacon/rewards/blocks/1',
      expect.any(Object),
    );

    // This assertion verifies normal processing consumed the completed prefetch without fetching again.
    expect(getSpy).toHaveBeenCalledTimes(1);

    // This second normal call verifies the prefetched block reward is consumed only once.
    const secondResult = await beaconClient.getBlockRewards(1);

    // This assertion verifies processing receives fresh data after the prefetched entry is deleted.
    expect(secondResult).toEqual({
      data: {
        proposer_index: '1',
        total: '20',
      },
    });

    // This assertion verifies the consumed cache entry was not reused.
    expect(getSpy).toHaveBeenCalledTimes(2);
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
      archiveNodeRetries: 1,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This error simulates an auth failure from the configured archive endpoint during prefetch.
    const prefetchError = new AxiosError('Request failed with status code 401');
    prefetchError.response = {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config: {} as never,
      data: { message: 'Unauthorized' },
    };

    // This spy makes prefetch fail and the strict normal request succeed afterward.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const getSpy = vi
      .spyOn(axiosInstance, 'get' as never)
      .mockRejectedValueOnce(prefetchError)
      .mockResolvedValueOnce({
        data: {
          data: {
            proposer_index: '1',
            total: '10',
          },
        },
      } as never);

    // This call starts a fire-and-forget prefetch that should fail silently.
    beaconClient.prefetchBlockRewards(1);

    // This wait confirms the prefetch request reached the configured archive endpoint.
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));

    // This wait covers the normal retry window; prefetch failures must not retry.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // This assertion verifies the failed prefetch did not make a retry attempt.
    expect(getSpy).toHaveBeenCalledTimes(1);

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
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  // This test verifies an incomplete 200 response from block reward prefetch does not poison processing.
  it('fetches block rewards normally after an incomplete prefetched response', async () => {
    // This client is configured far behind head so block reward prefetching warms the archive cache path.
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

    // This spy returns a malformed successful response first, then the valid reward expected later.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const getSpy = vi
      .spyOn(axiosInstance, 'get' as never)
      .mockResolvedValueOnce({
        data: {
          data: {
            proposer_index: '1',
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          data: {
            proposer_index: '1',
            total: '10',
          },
        },
      } as never);

    // This prefetch simulates a beacon node returning HTTP 200 before the reward payload is usable.
    beaconClient.prefetchBlockRewards(1);

    // This wait confirms the malformed response has completed before normal processing starts.
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // This normal processing call must ignore the malformed prefetch result and request fresh data.
    const result = await beaconClient.getBlockRewards(1);

    // This assertion verifies processing receives the later complete reward payload.
    expect(result).toEqual({
      data: {
        proposer_index: '1',
        total: '10',
      },
    });

    // This assertion verifies the incomplete prefetch response was not reused from cache.
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  // This test verifies an incomplete normal block reward response is treated as a retryable fetch failure.
  it('does not cache incomplete block rewards from normal processing', async () => {
    // This client exercises the strict processing path without relying on prefetched cache entries.
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

    // This spy returns a malformed 200 response first, then a complete reward for the retry.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { get: unknown } })
      .axiosInstance;
    const getSpy = vi
      .spyOn(axiosInstance, 'get' as never)
      .mockResolvedValueOnce({
        data: {
          data: {
            proposer_index: '1',
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          data: {
            proposer_index: '1',
            total: '10',
          },
        },
      } as never);

    // This first processing call should reject because the reward is missing the total amount.
    await expect(beaconClient.getBlockRewards(1)).rejects.toThrow(
      'Incomplete block rewards response',
    );

    // This second processing call should make a fresh request instead of reusing the bad payload.
    const result = await beaconClient.getBlockRewards(1);

    // This assertion verifies processing receives the complete reward after the bad response.
    expect(result).toEqual({
      data: {
        proposer_index: '1',
        total: '10',
      },
    });

    // This assertion verifies the incomplete normal response was not cached.
    expect(getSpy).toHaveBeenCalledTimes(2);
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

    // This spy verifies normal processing consumes only a completed prefetched cache entry.
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

    // This wait confirms the prefetched response has completed and exists as a cache entry.
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // This normal processing call should consume the completed prefetched request result.
    const result = await beaconClient.getCommittees(2, 64);

    // This assertion verifies normal processing receives the prefetched endpoint result.
    expect(result).toEqual([
      {
        index: '0',
        slot: '64',
        validators: ['1'],
      },
    ]);

    // This assertion verifies normal processing consumed the completed prefetch without fetching again.
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
      archiveNodeRetries: 1,
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

    // This wait confirms the prefetch request reached the configured archive endpoint.
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));

    // This wait covers the normal retry window; prefetch failures must not retry.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // This assertion verifies the failed prefetch did not make a retry attempt.
    expect(getSpy).toHaveBeenCalledTimes(1);

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

  // This test verifies normal processing does not join an in-flight committee prefetch.
  it('fetches committees directly while a prefetch is in flight', async () => {
    // This client allows the direct normal request to run while the prefetch request is still open.
    const beaconClient = new BeaconClient({
      fullNodeUrl: 'http://full-node',
      fullNodeConcurrency: 2,
      fullNodeRetries: 0,
      archiveNodeUrl: 'http://archive-node',
      archiveNodeConcurrency: 2,
      archiveNodeRetries: 0,
      baseDelay: 1,
      slotStartIndexing: 1,
      slotsPerEpoch: 32,
    });

    // This deferred response keeps the prefetch request in flight during normal processing.
    let resolvePrefetchResponse: (value: unknown) => void;
    const prefetchResponsePromise = new Promise((resolve) => {
      resolvePrefetchResponse = resolve;
    });

    // This spy keeps prefetch open and returns a separate response for the normal request.
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

    // This call starts a prefetch request that normal processing must not join.
    beaconClient.prefetchCommittees(2, 64);

    // This wait confirms the prefetch request is in flight.
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));

    // This normal call should make its own request because no completed cache entry exists.
    const committeesPromise = beaconClient.getCommittees(2, 64);

    // This wait verifies the normal request started before the prefetched response completed.
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));

    // This assertion verifies normal processing receives the direct request response.
    await expect(committeesPromise).resolves.toEqual([
      {
        index: '0',
        slot: '64',
        validators: ['1'],
      },
    ]);

    // This response lets the fire-and-forget prefetch settle after normal processing is complete.
    resolvePrefetchResponse!({
      data: {
        data: [
          {
            index: 'prefetch',
            slot: '64',
            validators: ['9'],
          },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // This assertion verifies prefetch and normal processing used separate requests.
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

  // This test verifies simultaneous sync committee reward reads do not use the prefetch cache as a request cache.
  it('fetches concurrent sync committee reward requests independently', async () => {
    // This client uses a single archive request lane so direct duplicate requests are easy to observe.
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

    // These calls simulate two normal processing reads without a completed prefetched value.
    const [firstResult, secondResult] = await Promise.all([
      beaconClient.getSyncCommitteeRewards(1, ['1', '2']),
      beaconClient.getSyncCommitteeRewards(1, ['1', '2']),
    ]);

    // This assertion verifies both callers still receive the endpoint result shape.
    expect(firstResult).toEqual(secondResult);

    // This assertion verifies normal reads do not coalesce through the prefetch cache.
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  // This test verifies validator order does not make normal reads use the prefetch cache.
  it('fetches sync committee reward requests independently when validator order differs', async () => {
    // This client exercises normal sync committee rewards without a completed prefetched value.
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

    // This assertion verifies normal reads bypass cache coalescing even with a canonical prefetch key.
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  // This test verifies normal sync committee reads do not populate reusable cache entries.
  it('fetches sync committee rewards normally after a normal request', async () => {
    // This client exercises two normal sync committee reward reads with no prefetched value.
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

    // This first call fetches rewards through the normal processing path.
    await beaconClient.getSyncCommitteeRewards(1, ['1']);

    // This second call should fetch again because normal reads must not populate cache.
    const result = await beaconClient.getSyncCommitteeRewards(1, ['1']);

    // This assertion verifies the second call returns the fresh endpoint response.
    expect(result).toEqual({
      data: [{ validator_index: '1', reward: '20' }],
      execution_optimistic: false,
      finalized: true,
    });

    // This assertion verifies the first normal response was not stored for reuse.
    expect(postSpy).toHaveBeenCalledTimes(2);
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

  // This test verifies sync committee prefetch errors do not enter the normal retry loop.
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

    // This spy makes every configured archive attempt receive the failed response.
    const axiosInstance = (beaconClient as unknown as { axiosInstance: { post: unknown } })
      .axiosInstance;
    const postSpy = vi.spyOn(axiosInstance, 'post' as never).mockRejectedValue(prefetchError);

    // This call starts a fire-and-forget prefetch that should stop after the first failure.
    beaconClient.prefetchSyncCommitteeRewards(1, ['1']);

    // This wait lets the fire-and-forget prefetch make the initial request.
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));

    // This wait covers the retry delay that would run for normal archive requests.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // This assertion verifies prefetch treated the failed response as final.
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  // This test verifies sync committee prefetch entries are consumed once by normal processing.
  it('serves sync committee rewards from a completed prefetch once', async () => {
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

    // This spy returns different responses so one-shot consumption is observable.
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

    // This call starts the prefetch request for the slot and validators.
    beaconClient.prefetchSyncCommitteeRewards(1, ['1']);

    // This wait confirms the prefetched response has completed and exists as a cache entry.
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // This call consumes the completed prefetched response.
    const result = await beaconClient.getSyncCommitteeRewards(1, ['1']);

    // This assertion verifies normal processing receives the prefetched response.
    expect(result).toEqual({
      data: [{ validator_index: '1', reward: '10' }],
      execution_optimistic: false,
      finalized: true,
    });

    // This assertion verifies the configured archive node served the prefetch request.
    expect(postSpy).toHaveBeenCalledWith(
      'http://archive-node/eth/v1/beacon/rewards/sync_committee/1',
      ['1'],
      expect.any(Object),
    );

    // This assertion verifies normal processing consumed the completed prefetch without fetching again.
    expect(postSpy).toHaveBeenCalledTimes(1);

    // This second normal call verifies the prefetched rewards are consumed only once.
    const secondResult = await beaconClient.getSyncCommitteeRewards(1, ['1']);

    // This assertion verifies processing receives fresh data after the prefetched entry is deleted.
    expect(secondResult).toEqual({
      data: [{ validator_index: '1', reward: '20' }],
      execution_optimistic: false,
      finalized: true,
    });

    // This assertion verifies the consumed cache entry was not reused.
    expect(postSpy).toHaveBeenCalledTimes(2);
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

    // This assertion verifies normal processing made a configured-node request after prefetch 404.
    expect(postSpy).toHaveBeenCalledTimes(2);
  });
});
