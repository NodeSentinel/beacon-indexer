import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPrismaCommand, parsePrismaArgs } from './prisma-env.js';

// Verifies that Prisma commands require a chain and default to the dev environment.
test('parses prisma args with dev as the default environment', () => {
  const parsed = parsePrismaArgs('db:migrate', ['--chain=gnosis']);

  assert.equal(parsed.chain, 'gnosis');
  assert.equal(parsed.env, 'dev');
  assert.equal(parsed.script, 'db:migrate');
});

// Verifies that invalid chains fail before any Prisma command runs.
test('rejects prisma args without a supported chain', () => {
  assert.throws(() => parsePrismaArgs('db:migrate', ['--env=dev']), /Invalid chain/);
});

// Verifies that the Prisma runner uses dotenvx composition with a local DB host override.
test('builds prisma command with dotenvx overload and localhost override', () => {
  const parsed = parsePrismaArgs('db:deploy', ['--chain=ethereum', '--env=prod']);
  const command = buildPrismaCommand(parsed, '/repo');

  assert.deepEqual(command.args, [
    'exec',
    'dotenvx',
    'run',
    '--overload',
    '-f',
    '/repo/env/ethereum/prod/db.env',
    '--env',
    'POSTGRES_HOST=localhost',
    '--',
    'pnpm',
    '--filter',
    '@beacon-indexer/db',
    'run',
    'db:deploy',
  ]);
  assert.deepEqual(command.requiredEnvFiles, ['/repo/env/ethereum/prod/db.env']);
});

// Verifies that destructive reset is not exposed by the root Prisma runner.
test('rejects prisma reset entirely', () => {
  assert.throws(() => parsePrismaArgs('db:reset', ['--chain=gnosis', '--env=dev']), /Invalid/);
});
