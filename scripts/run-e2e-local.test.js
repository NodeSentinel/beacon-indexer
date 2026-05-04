import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMigrationCommand,
  buildPackageTestCommand,
  buildPostgresRunCommand,
  parsePackageArg,
} from './run-e2e-local.js';

// Verifies that the package selector keeps the existing root script behavior.
test('parses e2e package selector', () => {
  assert.deepEqual(parsePackageArg(undefined), ['indexer', 'api']);
  assert.deepEqual(parsePackageArg('all'), ['indexer', 'api']);
  assert.deepEqual(parsePackageArg('indexer'), ['indexer']);
  assert.deepEqual(parsePackageArg('api'), ['api']);
});

// Verifies that unsupported package selectors fail before Docker is touched.
test('rejects unknown e2e package selector', () => {
  assert.throws(() => parsePackageArg('webapp'), /Unknown package/);
});

// Verifies that the Postgres container command stays hermetic and does not read runtime envs.
test('builds e2e postgres docker run command', () => {
  const command = buildPostgresRunCommand();

  assert.equal(command.command, 'docker');
  assert.deepEqual(command.args.slice(0, 4), ['run', '--name', 'e2e-postgres', '-e']);
  assert.ok(command.args.includes('POSTGRES_DB=e2e_beacon'));
  assert.ok(command.args.includes('POSTGRES_USER=e2e_user'));
  assert.ok(command.args.includes('POSTGRES_PASSWORD=e2e_password'));
  assert.ok(command.args.includes('5499:5432'));
});

// Verifies that migrations run against the fixed e2e database URL.
test('builds e2e migration command', () => {
  const command = buildMigrationCommand();

  assert.deepEqual(command.args, [
    '--filter',
    '@beacon-indexer/db',
    'exec',
    'prisma',
    'migrate',
    'deploy',
    '--schema=prisma/schema.prisma',
  ]);
  assert.equal(
    command.env.DATABASE_URL,
    'postgresql://e2e_user:e2e_password@localhost:5499/e2e_beacon?schema=public',
  );
});

// Verifies that package tests receive only the env required for their e2e suite.
test('builds api e2e command with api runtime defaults', () => {
  const command = buildPackageTestCommand('api');

  assert.deepEqual(command.args, ['--filter', '@beacon-indexer/api', 'run', 'test:e2e']);
  assert.equal(command.env.CHAIN, 'gnosis');
  assert.equal(command.env.API_TOKEN_SECRET, 'test-secret-must-be-at-least-32-characters-long');
  assert.equal(command.env.TELEGRAM_BOT_TOKEN, 'fake-token-for-e2e');
});
