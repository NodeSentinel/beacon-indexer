import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDevCommand,
  buildDockerCommand,
  parseDevArgs,
  parseDockerArgs,
} from './env-commands.js';

// Verifies that production Docker always requires the full closed stack.
test('builds the production docker stack only when all services are enabled', () => {
  const args = parseDockerArgs(['--chain=gnosis', '--env=prod', '--all']);
  const command = buildDockerCommand(args, '/repo');

  assert.deepEqual(command.services, []);
  assert.equal(command.env.DB_ENV_FILE, '/repo/env/gnosis/prod/db.env');
  assert.equal(command.env.INDEXER_ENV_FILE, '/repo/env/gnosis/prod/indexer.env');
  assert.equal(command.env.API_ENV_FILE, '/repo/env/gnosis/prod/api.env');
  assert.equal(command.env.BOT_ENV_FILE, '/repo/env/gnosis/prod/bot.env');
  assert.equal(command.args.at(-2), '-d');
  assert.equal(command.args.at(-1), '--build');
});

// Verifies that development Docker starts infra plus only requested app services.
test('builds the development docker stack with selected services', () => {
  const args = parseDockerArgs(['--chain=ethereum', '--env=dev', '--indexer', '--bot']);
  const command = buildDockerCommand(args, '/repo');

  assert.deepEqual(command.services, [
    'postgres',
    'loki',
    'prometheus',
    'grafana',
    'indexer',
    'bot',
  ]);
  assert.equal(command.env.DB_ENV_FILE, '/repo/env/ethereum/dev/db.env');
  assert.equal(command.env.INDEXER_ENV_FILE, '/repo/env/ethereum/dev/indexer.env');
  assert.equal(command.env.API_ENV_FILE, '/repo/env/ethereum/dev/api.env');
  assert.equal(command.env.BOT_ENV_FILE, '/repo/env/ethereum/dev/bot.env');
});

// Verifies that Docker Compose publishes Postgres on the configured host port.
test('docker compose publishes postgres with the postgres port env var', () => {
  const command = buildDockerCommand(
    parseDockerArgs(['--chain=gnosis', '--env=dev']),
    process.cwd(),
  );

  assert.equal(command.env.POSTGRES_PORT, '5441');
});

// Verifies that development Docker can use the same all flag as production.
test('builds the full development docker stack with all services enabled', () => {
  const args = parseDockerArgs(['--chain=ethereum', '--env=dev', '--all']);
  const command = buildDockerCommand(args, '/repo');

  assert.deepEqual(command.services, []);
});

// Verifies that the full Docker stack exposes the API port from the API env file.
test('builds docker with the api port env var', () => {
  const command = buildDockerCommand(parseDockerArgs(['--chain=gnosis', '--env=dev', '--all']));

  assert.equal(command.env.API_PORT, '3005');
});

// Verifies that Docker down loads every env file required by Compose interpolation.
test('builds docker down with all compose env vars', () => {
  const command = buildDockerCommand(parseDockerArgs(['--chain=gnosis', '--env=dev', '--down']));

  assert.deepEqual(command.args, [
    'compose',
    '-f',
    '/Users/nicosampler/develop/beacon-chain-validators-monitor/infra/docker/docker-compose.yml',
    'down',
  ]);
  assert.equal(command.env.DB_ENV_FILE, `${process.cwd()}/env/gnosis/dev/db.env`);
  assert.equal(command.env.API_ENV_FILE, `${process.cwd()}/env/gnosis/dev/api.env`);
  assert.equal(command.env.INDEXER_ENV_FILE, `${process.cwd()}/env/gnosis/dev/indexer.env`);
  assert.equal(command.env.BOT_ENV_FILE, `${process.cwd()}/env/gnosis/dev/bot.env`);
  assert.equal(command.env.POSTGRES_PORT, '5441');
  assert.equal(command.env.API_PORT, '3005');
});

// Verifies that a Docker bot stack loads the API env needed by its API dependency.
test('builds docker bot stack with api env for the api dependency', () => {
  const command = buildDockerCommand(parseDockerArgs(['--chain=gnosis', '--env=dev', '--bot']));

  assert.equal(command.env.API_ENV_FILE, `${process.cwd()}/env/gnosis/dev/api.env`);
  assert.equal(command.env.API_PORT, '3005');
});

// Verifies that production Docker must be intentionally full stack.
test('rejects production docker without all services', () => {
  assert.throws(() => parseDockerArgs(['--chain=gnosis', '--env=prod', '--api']), /requires --all/);
});

// Verifies that the all flag cannot be combined with partial service flags.
test('rejects all docker with partial service flags', () => {
  assert.throws(
    () => parseDockerArgs(['--chain=gnosis', '--env=dev', '--all', '--api']),
    /--all cannot be combined/,
  );
});

// Verifies that API standalone composes db env, local host override, and service env.
test('builds an api standalone command with dotenvx overload', () => {
  const args = parseDevArgs('api', ['--chain=gnosis', '--env=prod']);
  const command = buildDevCommand(args, '/repo');

  assert.deepEqual(command.args, [
    'exec',
    'dotenvx',
    'run',
    '--overload',
    '-f',
    '/repo/env/gnosis/prod/db.env',
    '--env',
    'POSTGRES_HOST=localhost',
    '-f',
    '/repo/env/gnosis/prod/api.env',
    '--',
    'pnpm',
    '--filter',
    '@beacon-indexer/api',
    'run',
    'dev',
  ]);
  assert.deepEqual(command.env, {});
});

// Verifies that bot host runtime loads only the bot env file.
test('builds a bot host command with only bot env', () => {
  const args = parseDevArgs('bot', ['--chain=ethereum', '--env=dev']);
  const command = buildDevCommand(args, '/repo');

  assert.deepEqual(command.args.slice(0, 7), [
    'exec',
    'dotenvx',
    'run',
    '--overload',
    '-f',
    '/repo/env/ethereum/dev/bot.env',
    '--',
  ]);
  assert.deepEqual(command.requiredEnvFiles, ['/repo/env/ethereum/dev/bot.env']);
});

// Verifies that webapp host runtime loads only the webapp env file.
test('builds a webapp host command with only webapp env', () => {
  const args = parseDevArgs('webapp', ['--chain=ethereum', '--env=dev']);
  const command = buildDevCommand(args, '/repo');

  assert.deepEqual(command.args.slice(0, 7), [
    'exec',
    'dotenvx',
    'run',
    '--overload',
    '-f',
    '/repo/env/ethereum/dev/webapp.env',
    '--',
  ]);
  assert.deepEqual(command.requiredEnvFiles, ['/repo/env/ethereum/dev/webapp.env']);
});

// Verifies that unknown chain values are rejected before any command runs.
test('rejects unsupported chains', () => {
  assert.throws(() => parseDevArgs('api', ['--chain=holesky', '--env=dev']), /Invalid chain/);
});
