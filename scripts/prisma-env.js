#!/usr/bin/env node

import {
  assertChain,
  assertEnv,
  getFlagValue,
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

// Builds the dotenvx-backed Prisma command for the selected chain/env.
export function buildPrismaCommand(parsed, rootDir = process.cwd()) {
  const envFile = serviceEnvPath(rootDir, parsed.chain, parsed.env, 'db');

  return {
    command: 'pnpm',
    args: [
      'exec',
      'dotenvx',
      'run',
      '--overload',
      '-f',
      envFile,
      '--env',
      'POSTGRES_HOST=localhost',
      '--',
      'pnpm',
      '--filter',
      '@beacon-indexer/db',
      'run',
      parsed.script,
    ],
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
