const E2E_DATABASE_URL =
  'postgresql://e2e_user:e2e_password@localhost:5499/e2e_beacon?schema=public';

/**
 * Forces indexer e2e tests to use the local Docker test database.
 */
function forceE2eDatabaseUrl() {
  process.env.DATABASE_URL = E2E_DATABASE_URL;
}

forceE2eDatabaseUrl();

export {};
