import path from 'node:path';

import {
  assertChain,
  assertEnv,
  getFlagValue,
  hasFlag,
  readEnvFile,
  runCommand,
  serviceEnvPath,
} from './runtime-helpers.js';

const DOCKER_SERVICES = ['indexer', 'api', 'bot'];
const DOCKER_ENV_SERVICES = ['db', 'indexer', 'api', 'bot'];
const BASE_DOCKER_DEV_SERVICES = ['postgres', 'loki', 'prometheus', 'grafana'];
const PACKAGE_BY_SERVICE = {
  api: '@beacon-indexer/api',
  bot: 'telegram-bot',
  indexer: 'indexer',
  webapp: '@beacon-indexer/webapp',
};

// Parses the Docker stack arguments into a normalized command model.
export function parseDockerArgs(args) {
  const chain = getFlagValue(args, 'chain');
  const env = hasFlag(args, 'prod') ? 'prod' : getFlagValue(args, 'env');
  const all = hasFlag(args, 'all');
  const down = hasFlag(args, 'down');
  const selectedServices = DOCKER_SERVICES.filter((service) => hasFlag(args, service));

  assertChain(chain);
  assertEnv(env);

  if (all && selectedServices.length > 0) {
    throw new Error('--all cannot be combined with --indexer, --api, or --bot.');
  }

  if (env === 'prod' && !all && !down) {
    throw new Error('Production Docker requires --all.');
  }

  return {
    chain,
    env,
    all,
    down,
    selectedServices,
  };
}

// Builds the docker compose command and environment from parsed arguments.
export function buildDockerCommand(parsed, rootDir = process.cwd()) {
  const services = parsed.down
    ? []
    : parsed.all
      ? []
      : [...BASE_DOCKER_DEV_SERVICES, ...parsed.selectedServices];
  const enabledServices = parsed.down
    ? [...DOCKER_ENV_SERVICES]
    : parsed.all
      ? [...DOCKER_ENV_SERVICES]
      : ['db', ...parsed.selectedServices];

  if (!enabledServices.includes('api') && enabledServices.includes('bot')) {
    enabledServices.push('api');
  }
  const serviceEnv = Object.fromEntries(
    enabledServices
      .filter((service) => DOCKER_ENV_SERVICES.includes(service))
      .map((service) => [
        `${service.toUpperCase()}_ENV_FILE`,
        serviceEnvPath(rootDir, parsed.chain, parsed.env, service),
      ]),
  );
  const dockerEnv = Object.values(serviceEnv).reduce(
    (env, filePath) => ({
      ...env,
      ...readEnvFile(filePath),
    }),
    {},
  );
  const args = [
    'compose',
    '-f',
    path.join(rootDir, 'infra/docker/docker-compose.yml'),
    parsed.down ? 'down' : 'up',
    ...services,
  ];

  if (!parsed.down) {
    args.push('-d', '--build');
  }

  return {
    command: 'docker',
    args,
    services,
    env: {
      ...serviceEnv,
      ...dockerEnv,
    },
    requiredEnvFiles: Object.values(serviceEnv),
  };
}

// Parses a local dev service command into a normalized command model.
export function parseDevArgs(service, args) {
  const chain = getFlagValue(args, 'chain');
  const env = getFlagValue(args, 'env');

  if (!PACKAGE_BY_SERVICE[service]) {
    throw new Error(`Invalid service "${service}". Expected api, bot, indexer, or webapp.`);
  }

  assertChain(chain);
  assertEnv(env);

  return { service, chain, env };
}

// Builds the pnpm command for running one service with a named env file.
export function buildDevCommand(parsed, rootDir = process.cwd()) {
  const dbEnvFile = serviceEnvPath(rootDir, parsed.chain, parsed.env, 'db');
  const envFile = serviceEnvPath(rootDir, parsed.chain, parsed.env, parsed.service);
  const dotenvxArgs = ['exec', 'dotenvx', 'run', '--overload'];

  if (['api', 'indexer'].includes(parsed.service)) {
    dotenvxArgs.push('-f', dbEnvFile, '--env', 'POSTGRES_HOST=localhost');
  }

  if (parsed.service === 'indexer') {
    dotenvxArgs.push('--env', 'LOKI_HOST=localhost');
  }

  dotenvxArgs.push('-f', envFile, '--');

  return {
    command: 'pnpm',
    args: [...dotenvxArgs, 'pnpm', '--filter', PACKAGE_BY_SERVICE[parsed.service], 'run', 'dev'],
    env: {},
    requiredEnvFiles: ['api', 'indexer'].includes(parsed.service)
      ? [dbEnvFile, envFile]
      : [envFile],
  };
}

export { runCommand };
