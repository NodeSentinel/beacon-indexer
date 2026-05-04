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
  assert.equal(command.env.API_ENV_FILE, undefined);
  assert.equal(command.env.BOT_ENV_FILE, '/repo/env/ethereum/dev/bot.env');
});

// Verifies that development Docker can use the same all flag as production.
test('builds the full development docker stack with all services enabled', () => {
  const args = parseDockerArgs(['--chain=ethereum', '--env=dev', '--all']);
  const command = buildDockerCommand(args, '/repo');

  assert.deepEqual(command.services, []);
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

// Verifies that bot standalone only needs the API host override before service env.
test('builds a bot standalone command with api host override', () => {
  const args = parseDevArgs('bot', ['--chain=ethereum', '--env=dev']);
  const command = buildDevCommand(args, '/repo');

  assert.deepEqual(command.args.slice(0, 8), [
    'exec',
    'dotenvx',
    'run',
    '--overload',
    '--env',
    'API_HOST=localhost',
    '-f',
    '/repo/env/ethereum/dev/bot.env',
  ]);
});

// Verifies that unknown chain values are rejected before any command runs.
test('rejects unsupported chains', () => {
  assert.throws(() => parseDevArgs('api', ['--chain=holesky', '--env=dev']), /Invalid chain/);
});
