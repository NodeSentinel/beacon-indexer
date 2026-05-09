import { describe, expect, it, vi } from 'vitest';

import {
  clearLidoCsmOperatorForCluster,
  createClearLidoCsmOperatorRoute,
} from './clear-lido-csm-operator.js';

describe('clearLidoCsmOperatorForCluster', () => {
  it('removes Lido-linked validators before clearing the cluster operator id', async () => {
    // This case verifies the explicit delete action removes validators linked to the operator id.
    const clearLidoOperatorFromOwnedCluster = vi.fn().mockResolvedValue({
      cluster: {
        id: 'cluster-a',
        lidoOperatorId: null,
      },
      removedValidatorCount: 2,
    });
    const findByPubkeys = vi.fn().mockResolvedValue([
      { index: 1, pubkey: '0xaaa', withdrawalAddress: null },
      { index: 2, pubkey: '0xbbb', withdrawalAddress: null },
    ]);
    const resolveLidoPubkeys = vi.fn().mockResolvedValue(['0xaaa', '0xbbb']);

    // Clears a configured operator id from the current user for one cluster.
    const result = await clearLidoCsmOperatorForCluster({
      clusterId: 'cluster-a',
      clusterStorage: { clearLidoOperatorFromOwnedCluster },
      executionRpcUrl: 'https://execution.example.com',
      lidoOperatorId: '221',
      resolveLidoPubkeys,
      userId: 'user-a',
      validatorStorage: { findByPubkeys },
    });

    // Confirms the operator id resolves through Lido CSM before database membership removal.
    expect(resolveLidoPubkeys).toHaveBeenCalledWith({
      operatorId: 221,
      rpcUrl: 'https://execution.example.com',
    });
    // Confirms validator removal and user clearing are delegated to one atomic storage operation.
    expect(clearLidoOperatorFromOwnedCluster).toHaveBeenCalledWith('cluster-a', 'user-a', [1, 2]);
    // Confirms the response exposes the removed indexes so the form can update immediately.
    expect(result.removedValidatorIndexes).toEqual([1, 2]);
    expect(result.lidoOperatorId).toBeNull();
  });

  it('fails before changing storage when the cluster has no Lido operator id', async () => {
    // This case verifies the delete action requires an existing Lido operator id.
    const findByPubkeys = vi.fn();
    const clearLidoOperatorFromOwnedCluster = vi.fn();
    const resolveLidoPubkeys = vi.fn();

    // Attempts to clear Lido CSM data without a stored operator id.
    await expect(
      clearLidoCsmOperatorForCluster({
        clusterId: 'cluster-a',
        clusterStorage: { clearLidoOperatorFromOwnedCluster },
        executionRpcUrl: 'https://execution.example.com',
        lidoOperatorId: null,
        resolveLidoPubkeys,
        userId: 'user-a',
        validatorStorage: { findByPubkeys },
      }),
    ).rejects.toThrow('Lido CSM operator id is required');

    // Confirms no external lookup or database mutation runs after validation fails.
    expect(resolveLidoPubkeys).not.toHaveBeenCalled();
    expect(findByPubkeys).not.toHaveBeenCalled();
    expect(clearLidoOperatorFromOwnedCluster).not.toHaveBeenCalled();
  });

  it('clears the cluster operator id when Lido validator resolution fails', async () => {
    // This case verifies broken external RPC resolution does not block cleanup of cluster metadata.
    const clearLidoOperatorFromOwnedCluster = vi.fn().mockResolvedValue({
      cluster: {
        id: 'cluster-a',
        lidoOperatorId: null,
      },
      removedValidatorCount: 0,
    });
    const findByPubkeys = vi.fn();
    const resolveLidoPubkeys = vi.fn().mockRejectedValue(new Error('RPC timeout'));

    // Clears the stored operator id even though linked validator indexes cannot be resolved.
    const result = await clearLidoCsmOperatorForCluster({
      clusterId: 'cluster-a',
      clusterStorage: { clearLidoOperatorFromOwnedCluster },
      executionRpcUrl: 'https://execution.example.com',
      lidoOperatorId: '221',
      resolveLidoPubkeys,
      userId: 'user-a',
      validatorStorage: { findByPubkeys },
    });

    // Confirms validator storage is skipped because no pubkeys were resolved.
    expect(findByPubkeys).not.toHaveBeenCalled();
    // Confirms cleanup still runs with an empty validator removal list.
    expect(clearLidoOperatorFromOwnedCluster).toHaveBeenCalledWith('cluster-a', 'user-a', []);
    expect(result.removedValidatorIndexes).toEqual([]);
    expect(result.lidoOperatorId).toBeNull();
  });
});

describe('createClearLidoCsmOperatorRoute', () => {
  it('registers the Lido CSM operator clear route under clusters', () => {
    // This case verifies the REST path models the cluster as the affected resource.
    const route = vi.fn().mockReturnThis();
    const input = vi.fn().mockReturnThis();
    const output = vi.fn().mockReturnThis();
    const handler = vi.fn().mockReturnValue('route-handler');
    const securedProcedure = { route, input, output, handler };

    // Creates the route with a minimal oRPC-like secured procedure chain.
    const createdRoute = createClearLidoCsmOperatorRoute({
      clusterStorage: {
        clearLidoOperatorFromOwnedCluster: vi.fn(),
        existsForOwner: vi.fn(),
        findById: vi.fn(),
      },
      executionRpcUrl: 'https://execution.example.com',
      procedures: { securedProcedure } as never,
      validatorStorage: { findByPubkeys: vi.fn() },
    });

    // Confirms the cluster-scoped route is exposed as the procedure result.
    expect(createdRoute).toBe('route-handler');
    // Confirms the route uses the cluster id path parameter instead of a user path body field.
    expect(route).toHaveBeenCalledWith({
      method: 'DELETE',
      path: '/clusters/{id}/lido-csm-operator',
    });
  });
});
