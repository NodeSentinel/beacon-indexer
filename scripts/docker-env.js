#!/usr/bin/env node

import { buildDockerCommand, parseDockerArgs, runCommand } from './env-commands.js';

// Starts Docker services for one chain and environment.
function main() {
  try {
    runCommand(buildDockerCommand(parseDockerArgs(process.argv.slice(2))));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
