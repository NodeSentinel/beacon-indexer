import type { DbUser } from '@/lib/orpc.js';

type ClusterOwnershipErrorResponse = {
  success: false;
  error: { code: string; message: string };
  meta: {
    timestamp: string;
  };
};

function buildOwnershipErrorResponse(code: string, message: string): ClusterOwnershipErrorResponse {
  return {
    success: false,
    error: { code, message },
    meta: { timestamp: new Date().toISOString() },
  };
}

/**
 * Verify that the current authenticated user owns the requested cluster.
 * Returns a standard API error response when access should be rejected.
 */
export async function requireOwnedCluster(
  storage: { existsForOwner: (id: string, ownerId: string) => Promise<boolean> },
  clusterId: string,
  user: DbUser | undefined,
): Promise<ClusterOwnershipErrorResponse | null> {
  // Require a resolved user so cluster ownership can be enforced.
  if (!user) {
    return buildOwnershipErrorResponse('UNAUTHORIZED', 'User authentication required');
  }

  // Hide whether the cluster exists when it does not belong to the caller.
  const clusterExistsForOwner = await storage.existsForOwner(clusterId, user.id);
  if (!clusterExistsForOwner) {
    return buildOwnershipErrorResponse(
      'CLUSTER_NOT_FOUND',
      `Cluster with id ${clusterId} not found`,
    );
  }

  return null;
}
