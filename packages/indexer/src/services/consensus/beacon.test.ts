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
});
