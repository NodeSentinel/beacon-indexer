import { addValidators } from './addValidators.js';
import { createCluster } from './create.js';
import { deleteCluster } from './delete.js';
import { getCluster } from './get.js';
import {
  listClusterIncidents,
  listIncidentAffectedValidators,
  markClusterIncidentClosedNotified,
  markClusterIncidentOpenedNotified,
} from './incidents.js';
import { listClusters } from './list.js';
import {
  getAllClustersMissedAttestations,
  getClusterMissedAttestations,
} from './missed-attestations.js';
import { removeValidators } from './removeValidators.js';
import { getAllClustersRewards, getClusterRewards } from './rewards.js';
import { getClusterSnapshot } from './snapshot.js';
import { getClusterSummary } from './summary.js';
import { updateCluster } from './update.js';

export const clusterRouter = {
  create: createCluster,
  list: listClusters,
  summary: getClusterSummary,
  get: getCluster,
  update: updateCluster,
  delete: deleteCluster,
  addValidators,
  removeValidators,
  incidents: listClusterIncidents,
  incidentAffectedValidators: listIncidentAffectedValidators,
  setIncidentClosedNotified: markClusterIncidentClosedNotified,
  setIncidentOpenedNotified: markClusterIncidentOpenedNotified,
  snapshot: getClusterSnapshot,
  missedAttestations: getClusterMissedAttestations,
  allMissedAttestations: getAllClustersMissedAttestations,
  rewards: getClusterRewards,
  allRewards: getAllClustersRewards,
};
