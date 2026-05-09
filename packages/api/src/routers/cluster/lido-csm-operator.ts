type ClusterLidoCsmOperatorConflict = {
  code: 'CLUSTER_LIDO_CSM_CONFLICT';
  message: string;
};

/**
 * Validates that one cluster cannot be linked to two different Lido CSM operator ids.
 */
export function validateClusterLidoCsmOperator(params: {
  currentLidoOperatorId: string | null;
  nextLidoCsmOperatorId: number | undefined;
}): ClusterLidoCsmOperatorConflict | null {
  if (
    params.nextLidoCsmOperatorId !== undefined &&
    params.currentLidoOperatorId !== null &&
    params.currentLidoOperatorId !== params.nextLidoCsmOperatorId.toString()
  ) {
    return {
      code: 'CLUSTER_LIDO_CSM_CONFLICT',
      message: 'Cluster already has a different CSM Lido id',
    };
  }

  return null;
}
