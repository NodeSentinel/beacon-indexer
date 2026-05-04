#!/usr/bin/env node

import { buildDevCommand, parseDevArgs, runCommand } from './env-commands.js';

// Starts one package dev process with the selected chain env file.
function main() {
  const [service, ...args] = process.argv.slice(2);

  try {
    runCommand(buildDevCommand(parseDevArgs(service, args)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
