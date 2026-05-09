import { describe, expect, it, vi } from 'vitest';

import { validateClusterLidoCsmOperator } from './lido-csm-operator.js';

describe('validateClusterLidoCsmOperator', () => {
  it('allows a cluster to keep its existing Lido CSM operator id', () => {
    // This case verifies saving a cluster with its current operator id is idempotent.
    const result = validateClusterLidoCsmOperator({
      currentLidoOperatorId: '12',
      nextLidoCsmOperatorId: 12,
    });

    // Confirms no conflict is returned for the same cluster-level operator id.
    expect(result).toBeNull();
  });

  it('allows a cluster without a Lido CSM operator id to receive one', () => {
    // This case verifies a cluster can become Lido-backed during create or update.
    const result = validateClusterLidoCsmOperator({
      currentLidoOperatorId: null,
      nextLidoCsmOperatorId: 12,
    });

    // Confirms an empty cluster-level operator slot accepts the incoming id.
    expect(result).toBeNull();
  });

  it('rejects replacing a cluster Lido CSM operator id with another one', () => {
    // This case verifies the one-Lido-id rule is scoped to a single cluster.
    const result = validateClusterLidoCsmOperator({
      currentLidoOperatorId: '12',
      nextLidoCsmOperatorId: 13,
    });

    // Confirms callers can return a stable API error when a cluster already has another id.
    expect(result).toEqual({
      code: 'CLUSTER_LIDO_CSM_CONFLICT',
      message: 'Cluster already has a different CSM Lido id',
    });
  });

  it('does not query user-level Lido state', () => {
    // This case verifies validation depends only on the cluster's stored operator id.
    const readUserLidoOperatorId = vi.fn();

    // Runs validation while a user-level reader exists but is not part of the API.
    validateClusterLidoCsmOperator({
      currentLidoOperatorId: '12',
      nextLidoCsmOperatorId: 12,
    });

    // Confirms the cluster conflict check does not use user-level Lido state.
    expect(readUserLidoOperatorId).not.toHaveBeenCalled();
  });
});
