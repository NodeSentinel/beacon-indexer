#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const E2E_CONFIG = {
  apiTokenSecret: 'test-secret-must-be-at-least-32-characters-long',
  chain: 'gnosis',
  containerName: 'e2e-postgres',
  databaseName: 'e2e_beacon',
  databasePassword: 'e2e_password',
  databasePort: '5440',
  databaseUser: 'e2e_user',
  telegramBotToken: 'fake-token-for-e2e',
};

const E2E_DATABASE_URL = `postgresql://${E2E_CONFIG.databaseUser}:${E2E_CONFIG.databasePassword}@localhost:${E2E_CONFIG.databasePort}/${E2E_CONFIG.databaseName}?schema=public`;

// Converts the optional package selector into the ordered package test list.
export function parsePackageArg(packageArg = 'all') {
  if (packageArg === 'all' || packageArg === '') {
    return ['indexer', 'api'];
  }

  if (packageArg === 'indexer' || packageArg === 'api') {
    return [packageArg];
  }

  throw new Error(`Unknown package: ${packageArg}. Expected indexer, api, or all.`);
}

// Builds the Docker command that starts the hermetic e2e Postgres container.
export function buildPostgresRunCommand() {
  return {
    command: 'docker',
    args: [
      'run',
      '--name',
      E2E_CONFIG.containerName,
      '-e',
      `POSTGRES_DB=${E2E_CONFIG.databaseName}`,
      '-e',
      `POSTGRES_USER=${E2E_CONFIG.databaseUser}`,
      '-e',
      `POSTGRES_PASSWORD=${E2E_CONFIG.databasePassword}`,
      '-p',
      `${E2E_CONFIG.databasePort}:5432`,
      '--tmpfs',
      '/var/lib/postgresql/data',
      '-d',
      'postgres:16',
    ],
    env: {},
  };
}

// Builds the Prisma migration command for the e2e database.
export function buildMigrationCommand() {
  return {
    command: 'pnpm',
    args: [
      '--filter',
      '@beacon-indexer/db',
      'exec',
      'prisma',
      'migrate',
      'deploy',
      '--schema=prisma/schema.prisma',
    ],
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
    },
  };
}

// Builds the package-specific e2e test command and env.
export function buildPackageTestCommand(packageName) {
  const packageFilter = packageName === 'api' ? '@beacon-indexer/api' : 'indexer';
  const env =
    packageName === 'api'
      ? {
          API_TOKEN_SECRET: E2E_CONFIG.apiTokenSecret,
          CHAIN: E2E_CONFIG.chain,
          DATABASE_URL: E2E_DATABASE_URL,
          TELEGRAM_BOT_TOKEN: E2E_CONFIG.telegramBotToken,
        }
      : {
          DATABASE_URL: E2E_DATABASE_URL,
        };

  return {
    command: 'pnpm',
    args: ['--filter', packageFilter, 'run', 'test:e2e'],
    env,
  };
}

// Builds the Docker command used to inspect Postgres readiness.
function buildPostgresReadyCommand() {
  return {
    command: 'docker',
    args: [
      'exec',
      E2E_CONFIG.containerName,
      'pg_isready',
      '-U',
      E2E_CONFIG.databaseUser,
      '-d',
      E2E_CONFIG.databaseName,
    ],
    env: {},
  };
}

// Builds the Docker command used for cleanup.
function buildDockerLifecycleCommand(action) {
  return {
    command: 'docker',
    args: [action, E2E_CONFIG.containerName],
    env: {},
  };
}

// Runs a command and returns its exit status.
function runCommand(commandModel, options = {}) {
  const result = spawnSync(commandModel.command, commandModel.args, {
    env: {
      ...process.env,
      ...commandModel.env,
    },
    stdio: options.stdio ?? 'inherit',
  });

  return result.status ?? 1;
}

// Runs one command and throws when it fails.
function runRequiredCommand(commandModel) {
  const status = runCommand(commandModel);

  if (status !== 0) {
    throw new Error(`${commandModel.command} ${commandModel.args.join(' ')} failed`);
  }
}

// Stops and removes the e2e database container if it exists.
function cleanupPostgres() {
  runCommand(buildDockerLifecycleCommand('stop'), { stdio: 'ignore' });
  runCommand(buildDockerLifecycleCommand('rm'), { stdio: 'ignore' });
}

// Waits for the e2e database to accept connections.
function waitForPostgres() {
  const readyCommand = buildPostgresReadyCommand();

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const status = runCommand(readyCommand, { stdio: 'ignore' });

    if (status === 0) {
      return;
    }

    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { stdio: 'ignore' });
  }

  throw new Error('PostgreSQL failed to start after 60 seconds');
}

// Runs the selected local e2e suites against the hermetic Postgres container.
function main() {
  const packageArg = process.argv[2] ?? 'all';
  const packages = parsePackageArg(packageArg);

  console.log(`Starting E2E tests locally (package: ${packageArg})`);

  try {
    cleanupPostgres();
    runRequiredCommand(buildPostgresRunCommand());
    waitForPostgres();
    runRequiredCommand(buildMigrationCommand());

    for (const packageName of packages) {
      runRequiredCommand(buildPackageTestCommand(packageName));
    }

    console.log('E2E tests completed');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    cleanupPostgres();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
