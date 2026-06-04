import { createAuthProcedures } from './auth/middleware.js';
import { isOriginAllowed } from './auth/origin.js';
import { createBotSignatureAuthenticator } from './auth/strategies/bot-signature.js';
import { createTelegramAuthenticator } from './auth/strategies/telegram.js';
import { createApiKeyAuthenticator } from './auth/strategies/token.js';
import { env } from './config/env.js';
import { SystemConfigController } from './controllers/systemConfig.js';
import { ValidatorController } from './controllers/validator.js';
import { startJobs, stopJobs } from './jobs/index.js';
import { createLogger } from './lib/logger.js';
import { createPrisma, disconnectPrisma } from './lib/prisma.js';
import { createRouter } from './routers/index.js';
import { createHttpServer } from './server.js';
import { createGnosisClaimWithdrawalsService } from './services/gnosis/claim-withdrawals.js';
import { AnalyticsStorage } from './storage/analytics.js';
import { BlockStorage } from './storage/block.js';
import { BotCommunicationsStorage } from './storage/bot-communications.js';
import { BotIncidentNotificationsStorage } from './storage/bot-incident-notifications.js';
import { BotNotificationsStorage } from './storage/bot-notifications.js';
import { BotUsersStorage } from './storage/bot-users.js';
import { ClusterStorage } from './storage/cluster.js';
import { IncidentStorage } from './storage/incident.js';
import { SystemConfigStorage } from './storage/systemConfig.js';
import { UserStorage } from './storage/user.js';
import { ValidatorStorage } from './storage/validator.js';
import { createBeaconHelpers } from './utils/beaconTime.js';

/**
 * Bootstraps the API runtime.
 */
async function main() {
  const logger = createLogger({
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
  });

  const prisma = createPrisma(env.DATABASE_URL, logger);

  const beaconHelpers = createBeaconHelpers({
    chain: env.CHAIN,
    lookbackSlot: env.CONSENSUS_LOOKBACK_SLOT,
  });

  const userStorage = new UserStorage(prisma);
  const validatorStorage = new ValidatorStorage(prisma);
  const validatorController = new ValidatorController({
    storage: validatorStorage,
    beaconHelpers,
    chain: env.CHAIN,
  });
  const systemConfigStorage = new SystemConfigStorage(prisma);
  const systemConfigController = new SystemConfigController(systemConfigStorage);

  const procedures = createAuthProcedures({
    ...createApiKeyAuthenticator(env.API_TOKEN_SECRET),
    ...createBotSignatureAuthenticator(env.TELEGRAM_BOT_TOKEN),
    ...createTelegramAuthenticator({
      maxAgeSeconds: env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
      telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    }),
    isOriginAllowed: (origin) =>
      isOriginAllowed(origin, {
        allowedOrigins: env.ALLOWED_ORIGINS,
        logger,
      }),
    userStorage,
  });

  const router = createRouter({
    analyticsStorage: new AnalyticsStorage(prisma),
    beaconHelpers,
    blockStorage: new BlockStorage(prisma),
    botCommunicationsStorage: new BotCommunicationsStorage(prisma),
    botIncidentNotificationsStorage: new BotIncidentNotificationsStorage(prisma),
    botNotificationsStorage: new BotNotificationsStorage(prisma),
    botUsersStorage: new BotUsersStorage(prisma),
    chain: env.CHAIN,
    claimWithdrawalsService: createGnosisClaimWithdrawalsService({
      depositContractAddress: env.BLOCKCHAIN_SC_DEPOSIT_ADDRESS,
      executionExplorerUrl: env.EXECUTION_EXPLORER_URL,
      privateKey: env.NODE_SENTINEL_PRIVATE_KEY,
      rpcUrl: env.EXECUTION_RPC_URL,
    }),
    clusterStorage: new ClusterStorage(prisma),
    executionRpcUrl: env.EXECUTION_RPC_URL,
    incidentStorage: new IncidentStorage(prisma),
    logger,
    nativeTokenDecimals: env.NATIVE_TOKEN_DECIMALS,
    prisma,
    procedures,
    systemConfigController,
    tokenPriceApiUrl: env.COINGECKO_TOKEN_PRICE_API_URL,
    tokenPriceTokenName: env.COINGECKO_TOKEN_NAME,
    userStorage,
    validatorController,
    validatorStorage,
  });

  const server = createHttpServer({
    allowedOrigins: env.ALLOWED_ORIGINS,
    logger,
    router,
  });

  /**
   * Shuts down the API process gracefully.
   */
  async function cleanup() {
    logger.info('Starting graceful shutdown...');

    try {
      stopJobs(logger);

      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      logger.info('HTTP server closed');

      await disconnectPrisma(prisma, logger);
    } catch (error) {
      logger.error({ err: error }, 'Error during cleanup');
    }

    logger.info('Shutdown complete');
  }

  /**
   * Handles process shutdown signals.
   */
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('uncaughtException', async (error) => {
    logger.error({ err: error }, 'Uncaught exception');
    await cleanup();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason, promise) => {
    logger.error({ promise, reason }, 'Unhandled rejection');
    await cleanup();
    process.exit(1);
  });

  try {
    await prisma.$connect();
    logger.info('Database connected successfully');

    await new Promise<void>((resolve, reject) => {
      server.listen(env.API_PORT, '0.0.0.0', () => {
        logger.info(`HTTP server listening on port ${env.API_PORT}`);
        resolve();
      });

      server.on('error', (err) => {
        reject(err);
      });
    });

    startJobs({ logger, prisma });
    logger.info('API server started successfully');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    await cleanup();
    process.exit(1);
  }
}

void main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
