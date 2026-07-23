import { createServer } from 'node:http';

import { createAuthProcedures } from '@/auth/middleware.js';
import { isOriginAllowed } from '@/auth/origin.js';
import { createBotSignatureAuthenticator } from '@/auth/strategies/bot-signature.js';
import { createTelegramAuthenticator } from '@/auth/strategies/telegram.js';
import { createApiKeyAuthenticator } from '@/auth/strategies/token.js';
import { parseApiEnv } from '@/config/env.js';
import { SystemConfigController } from '@/controllers/systemConfig.js';
import { ValidatorController } from '@/controllers/validator.js';
import { createLogger } from '@/lib/logger.js';
import { createPrisma, disconnectPrisma } from '@/lib/prisma.js';
import { createRouter } from '@/routers/index.js';
import { createHttpServer } from '@/server.js';
import { createGnosisClaimWithdrawalsService } from '@/services/gnosis/claim-withdrawals.js';
import { AnalyticsStorage } from '@/storage/analytics.js';
import { BlockStorage } from '@/storage/block.js';
import { BotCommunicationsStorage } from '@/storage/bot-communications.js';
import { BotIncidentNotificationsStorage } from '@/storage/bot-incident-notifications.js';
import { BotNotificationsStorage } from '@/storage/bot-notifications.js';
import { BotUsersStorage } from '@/storage/bot-users.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { IncidentStorage } from '@/storage/incident.js';
import { SystemConfigStorage } from '@/storage/systemConfig.js';
import { UserStorage } from '@/storage/user.js';
import { ValidatorStorage } from '@/storage/validator.js';
import { WithdrawalStorage } from '@/storage/withdrawal.js';
import { createBeaconHelpers } from '@/utils/beaconTime.js';

interface E2EServerOverrides {
  allowedOrigins?: string;
  apiTokenSecret?: string;
  chain?: 'ethereum' | 'gnosis';
  consensusLookbackSlot?: number;
  databaseUrl?: string;
  executionRpcUrl?: string;
  nativeTokenDecimals?: number;
  nodeSentinelPrivateKey?: `0x${string}`;
  telegramBotToken?: string;
  telegramInitDataMaxAgeSeconds?: number;
  tokenPriceApiUrl?: string;
  tokenPriceTokenName?: string;
}

const FIXED_TOKEN_PRICE = 123.45;

export { FIXED_TOKEN_PRICE };

/**
 * Starts a local stub server that returns a fixed token price.
 * This keeps e2e tests off the network while still exercising the configured URL path.
 */
async function startTokenPriceStubServer(params: { tokenName: string }): Promise<{
  apiUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const requestedToken = requestUrl.searchParams.get('ids');
    const requestedCurrency = requestUrl.searchParams.get('vs_currencies');

    // Reject unexpected requests so tests prove the API used the configured URL and params.
    if (requestedToken !== params.tokenName || requestedCurrency !== 'usd') {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Unexpected token price request',
        }),
      );
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        [params.tokenName]: {
          usd: FIXED_TOKEN_PRICE,
        },
      }),
    );
  });

  const apiUrl = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address !== 'object') {
        throw new Error('Failed to resolve token price stub address');
      }

      resolve(`http://127.0.0.1:${address.port}/simple/price`);
    });
  });

  return {
    apiUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

/**
 * Starts an API server instance for E2E tests.
 */
export async function startE2EServer(overrides: E2EServerOverrides = {}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  server: ReturnType<typeof createServer>;
}> {
  const tokenName = overrides.tokenPriceTokenName ?? process.env.COINGECKO_TOKEN_NAME ?? 'ethereum';
  const tokenPriceStub =
    overrides.tokenPriceApiUrl === undefined
      ? await startTokenPriceStubServer({ tokenName })
      : null;

  const env = parseApiEnv({
    ALLOWED_ORIGINS: overrides.allowedOrigins ?? process.env.ALLOWED_ORIGINS!,
    API_TOKEN_SECRET: overrides.apiTokenSecret ?? process.env.API_TOKEN_SECRET!,
    CHAIN: overrides.chain ?? process.env.CHAIN,
    CONSENSUS_LOOKBACK_SLOT: String(
      overrides.consensusLookbackSlot ?? process.env.CONSENSUS_LOOKBACK_SLOT ?? 0,
    ),
    COINGECKO_TOKEN_PRICE_API_URL:
      overrides.tokenPriceApiUrl ??
      tokenPriceStub?.apiUrl ??
      process.env.COINGECKO_TOKEN_PRICE_API_URL!,
    COINGECKO_TOKEN_NAME: tokenName,
    DATABASE_URL: overrides.databaseUrl ?? process.env.DATABASE_URL!,
    EXECUTION_RPC_URL: overrides.executionRpcUrl ?? process.env.EXECUTION_RPC_URL!,
    NATIVE_TOKEN_DECIMALS: String(
      overrides.nativeTokenDecimals ?? process.env.NATIVE_TOKEN_DECIMALS ?? 18,
    ),
    NODE_SENTINEL_PRIVATE_KEY:
      overrides.nodeSentinelPrivateKey ?? process.env.NODE_SENTINEL_PRIVATE_KEY,
    NODE_ENV: process.env.NODE_ENV ?? 'test',
    TELEGRAM_BOT_TOKEN: overrides.telegramBotToken ?? process.env.TELEGRAM_BOT_TOKEN!,
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: String(
      overrides.telegramInitDataMaxAgeSeconds ??
        process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS ??
        60 * 60 * 24 * 7,
    ),
  });
  const logger = createLogger({
    logLevel: 'silent',
    nodeEnv: env.NODE_ENV,
  });
  const prisma = createPrisma(env.DATABASE_URL, logger);
  await prisma.$connect();
  const beaconHelpers = createBeaconHelpers({
    chain: env.CHAIN,
    lookbackSlot: env.CONSENSUS_LOOKBACK_SLOT,
  });
  const userStorage = new UserStorage(prisma);
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
  const validatorStorage = new ValidatorStorage(prisma);
  const validatorController = new ValidatorController({
    storage: validatorStorage,
    beaconHelpers,
    chain: env.CHAIN,
  });
  const systemConfigStorage = new SystemConfigStorage(prisma);
  const systemConfigController = new SystemConfigController(systemConfigStorage);
  const deps = {
    analyticsStorage: new AnalyticsStorage(prisma),
    beaconHelpers,
    blockStorage: new BlockStorage(prisma),
    botCommunicationsStorage: new BotCommunicationsStorage(prisma),
    botIncidentNotificationsStorage: new BotIncidentNotificationsStorage(prisma),
    botNotificationsStorage: new BotNotificationsStorage(prisma),
    botUsersStorage: new BotUsersStorage(prisma),
    chain: env.CHAIN,
    claimWithdrawalsService: createGnosisClaimWithdrawalsService({
      depositContractAddress: beaconHelpers.chainConfig.blockchain.scDepositAddress,
      executionExplorerUrl: beaconHelpers.chainConfig.blockchain.executionExplorerUrl,
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
    withdrawalStorage: new WithdrawalStorage(prisma),
  };
  const router = createRouter(deps);
  const server = createHttpServer({
    allowedOrigins: env.ALLOWED_ORIGINS,
    logger,
    router,
  });

  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address !== 'object') {
        throw new Error('Failed to resolve E2E server address');
      }

      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  return {
    baseUrl,
    server,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      await disconnectPrisma(prisma, logger);
      if (tokenPriceStub) {
        await tokenPriceStub.close();
      }
    },
  };
}
