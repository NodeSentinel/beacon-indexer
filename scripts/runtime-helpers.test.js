import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readEnvFile } from './runtime-helpers.js';

// Verifies that env files can compose values from earlier declarations.
test('expands env file variables in declaration order', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'runtime-helpers-'));
  const filePath = path.join(dir, 'db.env');

  writeFileSync(
    filePath,
    [
      'POSTGRES_USER=nodesentinel',
      'POSTGRES_PASSWORD=change-me',
      'POSTGRES_HOST=postgres',
      'POSTGRES_PORT=5432',
      'POSTGRES_DB=nodesentinel',
      'DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public',
    ].join('\n'),
  );

  assert.equal(
    readEnvFile(filePath).DATABASE_URL,
    'postgresql://nodesentinel:change-me@postgres:5432/nodesentinel?schema=public',
  );
});

// Verifies that missing references stay visible instead of becoming empty strings.
test('keeps unknown env file variables unchanged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'runtime-helpers-'));
  const filePath = path.join(dir, 'api.env');

  writeFileSync(filePath, 'DATABASE_URL=postgresql://${MISSING_USER}@postgres:5432/db');

  assert.equal(readEnvFile(filePath).DATABASE_URL, 'postgresql://${MISSING_USER}@postgres:5432/db');
});
