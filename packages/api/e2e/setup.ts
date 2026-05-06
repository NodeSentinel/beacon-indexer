const E2E_DATABASE_URL =
  'postgresql://e2e_user:e2e_password@localhost:5440/e2e_beacon?schema=public';
const E2E_API_TOKEN_SECRET = 'e2e-test-api-token-secret-1234567890';
const E2E_TELEGRAM_BOT_TOKEN = 'e2e-test-telegram-bot-token';
const E2E_ALLOWED_ORIGINS = 'http://localhost:3000';
const E2E_CHAIN = 'ethereum';
const E2E_NATIVE_TOKEN_DECIMALS = '18';
const E2E_COINGECKO_TOKEN_PRICE_API_URL = 'https://api.coingecko.com/api/v3/simple/price';
const E2E_COINGECKO_TOKEN_NAME = 'ethereum';

/**
 * Forces API e2e tests to use the local Docker test database.
 */
function forceE2eDatabaseUrl() {
  process.env.DATABASE_URL = E2E_DATABASE_URL;
}

/**
 * Sets default runtime values used by API e2e tests.
 * Individual suites can override these values via startE2EServer(overrides).
 */
function setE2eDefaults() {
  process.env.API_TOKEN_SECRET = process.env.API_TOKEN_SECRET ?? E2E_API_TOKEN_SECRET;
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? E2E_TELEGRAM_BOT_TOKEN;
  process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? E2E_ALLOWED_ORIGINS;
  process.env.CHAIN = process.env.CHAIN ?? E2E_CHAIN;
  process.env.CONSENSUS_LOOKBACK_SLOT = process.env.CONSENSUS_LOOKBACK_SLOT ?? '0';
  process.env.NATIVE_TOKEN_DECIMALS =
    process.env.NATIVE_TOKEN_DECIMALS ?? E2E_NATIVE_TOKEN_DECIMALS;
  process.env.COINGECKO_TOKEN_PRICE_API_URL =
    process.env.COINGECKO_TOKEN_PRICE_API_URL ?? E2E_COINGECKO_TOKEN_PRICE_API_URL;
  process.env.COINGECKO_TOKEN_NAME = process.env.COINGECKO_TOKEN_NAME ?? E2E_COINGECKO_TOKEN_NAME;
}

forceE2eDatabaseUrl();
setE2eDefaults();

export {};
