import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

import {
  getDailyArchiveActor,
  getHourlyArchiveActor,
  getMonthlyArchiveActor,
} from './archive/index.js';
import { getChainStatsActor } from './chainStats/index.js';
import { getCreateEpochActor, getEpochOrchestratorActor } from './epoch/index.js';

import { ChainStatsController } from '@/src/services/consensus/controllers/chainStats.js';
import { DailyArchiveController } from '@/src/services/consensus/controllers/dailyArchive.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { HourlyArchiveController } from '@/src/services/consensus/controllers/hourlyArchive.js';
import { MonthlyArchiveController } from '@/src/services/consensus/controllers/monthlyArchive.js';
import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
export default function initXstateMachines(
  epochController: EpochController,
  partitionController: PartitionController,
  beaconTime: BeaconTime,
  slotDuration: number,
  slotsPerEpoch: number,
  slotController: SlotController,
  validatorsController: ValidatorsController,
  hourlyArchiveController: HourlyArchiveController,
  dailyArchiveController: DailyArchiveController,
  monthlyArchiveController: MonthlyArchiveController,
  chainStatsController: ChainStatsController,
) {
  // Create and start hourly archive actor
  const hourlyArchiveActor = getHourlyArchiveActor(hourlyArchiveController);
  hourlyArchiveActor.start();

  // Create and start daily archive actor
  const dailyArchiveActor = getDailyArchiveActor(dailyArchiveController);
  dailyArchiveActor.start();

  // Create and start monthly archive actor
  const monthlyArchiveActor = getMonthlyArchiveActor(monthlyArchiveController);
  monthlyArchiveActor.start();

  // Create and start chain stats actor
  const chainStatsActor = getChainStatsActor(chainStatsController);
  chainStatsActor.start();

  getCreateEpochActor(epochController, slotDuration).start();

  // Epoch orchestrator receives archive and chain stats actors to forward EPOCH_PROCESSED events
  getEpochOrchestratorActor(
    epochController,
    partitionController,
    beaconTime,
    slotDuration,
    slotsPerEpoch,
    slotController,
    validatorsController,
    hourlyArchiveActor,
    dailyArchiveActor,
    monthlyArchiveActor,
    chainStatsActor,
  ).start();
}
