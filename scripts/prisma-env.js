#!/usr/bin/env node

import {
  assertChain,
  assertEnv,
  getFlagValue,
  readEnvFile,
  runCommand,
  serviceEnvPath,
} from './runtime-helpers.js';

const PRISMA_SCRIPTS = new Set(['db:migrate', 'db:deploy', 'db:push', 'db:studio']);

// Parses the Prisma runner args into a normalized command model.
export function parsePrismaArgs(script, args) {
  const chain = getFlagValue(args, 'chain');
  const env = getFlagValue(args, 'env') ?? 'dev';

  if (!PRISMA_SCRIPTS.has(script)) {
    throw new Error(`Invalid Prisma script "${script}".`);
  }

  assertChain(chain);
  assertEnv(env);

  return { chain, env, script };
}

// Builds the host-side Prisma command for the selected chain/env.
export function buildPrismaCommand(parsed, rootDir = process.cwd()) {
  const envFile = serviceEnvPath(rootDir, parsed.chain, parsed.env, 'db');
  const dbEnv = readEnvFile(envFile);
  const hostDbEnv = {
    ...dbEnv,
    POSTGRES_HOST: 'localhost',
  };

  hostDbEnv.DATABASE_URL = `postgresql://${hostDbEnv.POSTGRES_USER}:${hostDbEnv.POSTGRES_PASSWORD}@${hostDbEnv.POSTGRES_HOST}:${hostDbEnv.POSTGRES_PORT}/${hostDbEnv.POSTGRES_DB}?schema=public`;

  return {
    command: 'pnpm',
    args: ['pnpm', '--filter', '@beacon-indexer/db', 'run', parsed.script],
    env: hostDbEnv,
    requiredEnvFiles: [envFile],
  };
}

// Starts the Prisma command when this file is called directly.
function main() {
  const [script, ...args] = process.argv.slice(2);

  try {
    runCommand(buildPrismaCommand(parsePrismaArgs(script, args)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
