import { addValidators } from './addValidators.js';
import { createCluster } from './create.js';
import { deleteCluster } from './delete.js';
import { getCluster } from './get.js';
import { listClusters } from './list.js';
import { removeValidator } from './removeValidator.js';
import { removeValidatorsByAddress } from './removeValidatorsByAddress.js';
import { updateCluster } from './update.js';

export const clusterRouter = {
  create: createCluster,
  list: listClusters,
  get: getCluster,
  update: updateCluster,
  delete: deleteCluster,
  addValidators,
  removeValidator,
  removeValidatorsByAddress,
};
