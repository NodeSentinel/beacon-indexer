import type { PrismaClient } from '@beacon-indexer/db';

import type { ApiProcedures } from '@/auth/middleware.js';
import type { SystemConfigController } from '@/controllers/systemConfig.js';
import type { ValidatorController } from '@/controllers/validator.js';
import type { Logger } from '@/lib/logger.js';
import type { ClaimWithdrawalsService } from '@/services/gnosis/claim-withdrawals.js';
import type { AnalyticsStorage } from '@/storage/analytics.js';
import type { BlockStorage } from '@/storage/block.js';
import type { BotCommunicationsStorage } from '@/storage/bot-communications.js';
import type { BotIncidentNotificationsStorage } from '@/storage/bot-incident-notifications.js';
import type { BotNotificationsStorage } from '@/storage/bot-notifications.js';
import type { BotUsersStorage } from '@/storage/bot-users.js';
import type { ClusterStorage } from '@/storage/cluster.js';
import type { ConsolidationStorage } from '@/storage/consolidation.js';
import type { IncidentStorage } from '@/storage/incident.js';
import type { UserStorage } from '@/storage/user.js';
import type { ValidatorStorage } from '@/storage/validator.js';
import type { BeaconHelpers } from '@/utils/beaconTime.js';

/**
 * Shared runtime dependencies used by API factories.
 * Values are composed explicitly in index.ts.
 */
export interface ApiDependencies {
  analyticsStorage: AnalyticsStorage;
  beaconHelpers: BeaconHelpers;
  blockStorage: BlockStorage;
  botCommunicationsStorage: BotCommunicationsStorage;
  botIncidentNotificationsStorage: BotIncidentNotificationsStorage;
  botNotificationsStorage: BotNotificationsStorage;
  botUsersStorage: BotUsersStorage;
  clusterStorage: ClusterStorage;
  consolidationStorage: ConsolidationStorage;
  executionRpcUrl: string;
  incidentStorage: IncidentStorage;
  logger: Logger;
  nativeTokenDecimals: number;
  prisma: PrismaClient;
  procedures: ApiProcedures;
  systemConfigController: SystemConfigController;
  tokenPriceApiUrl: string;
  tokenPriceTokenName: string;
  userStorage: UserStorage;
  validatorController: ValidatorController;
  validatorStorage: ValidatorStorage;
  chain: 'ethereum' | 'gnosis';
  claimWithdrawalsService: ClaimWithdrawalsService | null;
}
