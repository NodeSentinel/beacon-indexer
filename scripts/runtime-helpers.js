import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CHAINS = new Set(['gnosis', 'ethereum']);
const ENVS = new Set(['dev', 'prod']);

// Returns the value from a --name=value CLI argument.
export function getFlagValue(args, name) {
  const prefix = `--${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);

  return value || undefined;
}

// Returns true when a boolean CLI flag is present.
export function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

// Validates that a chain is one of the supported beacon chains.
export function assertChain(chain) {
  if (!CHAINS.has(chain)) {
    throw new Error(`Invalid chain "${chain}". Expected gnosis or ethereum.`);
  }
}

// Validates that an environment is one of the supported runtime envs.
export function assertEnv(env) {
  if (!ENVS.has(env)) {
    throw new Error(`Invalid env "${env}". Expected dev or prod.`);
  }
}

// Builds the absolute env file path for one service.
export function serviceEnvPath(rootDir, chain, env, service) {
  return path.join(rootDir, 'env', chain, env, `${service}.env`);
}

// Expands ${VAR} references from previously parsed values or the process env.
function expandEnvValue(value, env) {
  return value.replace(
    /\$\{([A-Z0-9_]+)\}/g,
    (match, key) => env[key] ?? process.env[key] ?? match,
  );
}

// Parses KEY=value env files and expands ${VAR} references in declaration order.
export function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const env = {};
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');

    env[key] = expandEnvValue(value, env);
  }

  return env;
}

// Stops command execution when a required env file is missing.
export function assertEnvFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing env file: ${filePath}`);
  }
}

// Runs a command and exits with the child process status.
export function runCommand(commandModel) {
  for (const filePath of commandModel.requiredEnvFiles ?? []) {
    assertEnvFile(filePath);
  }

  const result = spawnSync(commandModel.command, commandModel.args, {
    env: {
      ...process.env,
      ...commandModel.env,
    },
    stdio: 'inherit',
  });

  process.exit(result.status ?? 1);
}
