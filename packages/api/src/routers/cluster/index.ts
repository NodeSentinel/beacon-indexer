import { createAddValidatorsRoute } from './addValidators.js';
import { createCreateClusterRoute } from './create.js';
import { createDeleteClusterRoute } from './delete.js';
import { createGetClusterRoute } from './get.js';
import { createClusterIncidentRoutes } from './incidents.js';
import { createListClustersRoute } from './list.js';
import {
  createAllClustersMissedAttestationsRoute,
  createClusterMissedAttestationsRoute,
} from './missed-attestations.js';
import { createRemoveValidatorsRoute } from './removeValidators.js';
import { createAllClustersRewardsRoute, createClusterRewardsRoute } from './rewards.js';
import { createClusterSnapshotRoute } from './snapshot.js';
import { createClusterSummaryRoute } from './summary.js';
import { createUpdateClusterRoute } from './update.js';
import type { ApiDependencies } from '@/dependencies.js';

/**
 * Creates the cluster router.
 */
export function createClusterRouter(
  deps: Pick<
    ApiDependencies,
    | 'analyticsStorage'
    | 'beaconHelpers'
    | 'clusterStorage'
    | 'incidentStorage'
    | 'procedures'
    | 'chain'
    | 'logger'
    | 'nativeTokenDecimals'
    | 'tokenPriceApiUrl'
    | 'tokenPriceTokenName'
  >,
) {
  const incidents = createClusterIncidentRoutes(deps);

  return {
    create: createCreateClusterRoute(deps),
    list: createListClustersRoute(deps),
    summary: createClusterSummaryRoute(deps),
    get: createGetClusterRoute(deps),
    update: createUpdateClusterRoute(deps),
    delete: createDeleteClusterRoute(deps),
    addValidators: createAddValidatorsRoute(deps),
    removeValidators: createRemoveValidatorsRoute(deps),
    incidents: incidents.listClusterIncidents,
    incidentAffectedValidators: incidents.listIncidentAffectedValidators,
    setIncidentClosedNotified: incidents.markClusterIncidentClosedNotified,
    setIncidentOpenedNotified: incidents.markClusterIncidentOpenedNotified,
    snapshot: createClusterSnapshotRoute(deps),
    missedAttestations: createClusterMissedAttestationsRoute(deps),
    allMissedAttestations: createAllClustersMissedAttestationsRoute(deps),
    rewards: createClusterRewardsRoute(deps),
    allRewards: createAllClustersRewardsRoute(deps),
  };
}
