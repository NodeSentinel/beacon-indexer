import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

// Verifies that the Prisma runner builds a host-side DATABASE_URL for SSH tunnels.
test('builds prisma command with localhost database url override', () => {
  const rootDir = path.join(tmpdir(), `prisma-env-test-${Date.now()}`);
  const envDir = path.join(rootDir, 'env', 'ethereum', 'prod');
  mkdirSync(envDir, { recursive: true });
  writeFileSync(
    path.join(envDir, 'db.env'),
    [
      'POSTGRES_USER=app',
      'POSTGRES_PASSWORD=secret',
      'POSTGRES_HOST=postgres',
      'POSTGRES_PORT=7770',
      'POSTGRES_DB=beacon',
      'DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public',
      '',
    ].join('\n'),
  );

  const parsed = parsePrismaArgs('db:deploy', ['--chain=ethereum', '--env=prod']);
  const command = buildPrismaCommand(parsed, rootDir);

  assert.deepEqual(command.args, ['pnpm', '--filter', '@beacon-indexer/db', 'run', 'db:deploy']);
  assert.equal(command.env.POSTGRES_HOST, 'localhost');
  assert.equal(
    command.env.DATABASE_URL,
    'postgresql://app:secret@localhost:7770/beacon?schema=public',
  );
  assert.deepEqual(command.requiredEnvFiles, [path.join(envDir, 'db.env')]);
});

// Verifies that destructive reset is not exposed by the root Prisma runner.
test('rejects prisma reset entirely', () => {
  assert.throws(() => parsePrismaArgs('db:reset', ['--chain=gnosis', '--env=dev']), /Invalid/);
});
