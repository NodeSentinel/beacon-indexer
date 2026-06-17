import { createAnonymousUserRoute } from './anonymous.js';
import { createUserClaimRoute } from './claim.js';
import { createUserClustersRoute } from './clusters.js';
import { createMeRoute } from './me.js';

/**
 * Creates the user router.
 */
export function createUserRouter(params: {
  chain: Parameters<typeof createUserClaimRoute>[0]['chain'];
  claimWithdrawalsService: Parameters<typeof createUserClaimRoute>[0]['claimWithdrawalsService'];
  clusterStorage: Parameters<typeof createUserClustersRoute>[0]['clusterStorage'];
  procedures: Parameters<typeof createAnonymousUserRoute>[0]['procedures'];
  userStorage: Parameters<typeof createAnonymousUserRoute>[0]['userStorage'] &
    Parameters<typeof createUserClaimRoute>[0]['userStorage'];
}) {
  return {
    anonymous: createAnonymousUserRoute(params),
    claim: createUserClaimRoute(params),
    clusters: createUserClustersRoute(params),
    me: createMeRoute(params),
  };
}
