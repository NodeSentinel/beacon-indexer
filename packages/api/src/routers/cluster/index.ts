import { addValidators } from './addValidators.js';
import { createCluster } from './create.js';
import { deleteCluster } from './delete.js';
import { getCluster } from './get.js';
import { listClusters } from './list.js';
import {
  getClusterMissedAttestations,
  getAllClustersMissedAttestations,
} from './missed-attestations.js';
import { removeValidators } from './removeValidators.js';
import { getClusterSnapshot } from './snapshot.js';
import { updateCluster } from './update.js';

export const clusterRouter = {
  create: createCluster,
  list: listClusters,
  get: getCluster,
  update: updateCluster,
  delete: deleteCluster,
  addValidators,
  removeValidators,
  snapshot: getClusterSnapshot,
  missedAttestations: getClusterMissedAttestations,
  allMissedAttestations: getAllClustersMissedAttestations,
};
