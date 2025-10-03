#!/usr/bin/env node

// Script to reset and recreate the initial migration during development
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

import { config } from 'dotenv';

// Load environment variables
let envPath = '.env';
let currentDir = process.cwd();

while (!existsSync(envPath) && currentDir !== dirname(currentDir)) {
  currentDir = dirname(currentDir);
  envPath = join(currentDir, '.env');
}

if (existsSync(envPath)) {
  config({ path: envPath });
  console.log('Environment variables loaded from', envPath);
}

const {
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_HOST,
  POSTGRES_PORT = '5432',
  POSTGRES_DB,
} = process.env;

// Determine the host based on environment
const isDocker = process.env.DOCKER_ENV === 'true';
const host = isDocker ? 'postgres' : POSTGRES_HOST || 'localhost';

// Build DATABASE_URL
const DATABASE_URL = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${host}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public`;
process.env.DATABASE_URL = DATABASE_URL;

console.log('🔗 DATABASE_URL constructed:', DATABASE_URL.replace(/:([^:@]+)@/, ':***@'));

// Safety checks to prevent production execution
function checkProductionSafety() {
  const { NODE_ENV = 'development', POSTGRES_HOST = 'localhost' } = process.env;

  const isLocalhost = POSTGRES_HOST === 'localhost';
  const isDevelopment = NODE_ENV === 'development';
  const isLocalDatabase = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1');

  if (!isLocalhost || !isDevelopment || !isLocalDatabase) {
    console.error('❌ This script can only be run on localhost in development mode!');
    console.error('   Required conditions:');
    console.error(`   - POSTGRES_HOST=localhost (current: ${POSTGRES_HOST})`);
    console.error(`   - NODE_ENV=development (current: ${NODE_ENV})`);
    console.error(`   - DATABASE_URL contains localhost (current: ${isLocalDatabase})`);
    process.exit(1);
  }
}

async function executeCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function resetInitialMigration() {
  try {
    // Run safety checks first
    checkProductionSafety();

    console.log('🔄 Step 1: Resetting database and migrations...');
    await executeCommand('npx', [
      'prisma',
      'migrate',
      'reset',
      '--force',
      '--schema=./packages/db/prisma/schema.prisma',
    ]);

    console.log('✨ Step 2: Creating new initial migration...');
    await executeCommand('npx', [
      'prisma',
      'migrate',
      'dev',
      '--name',
      'initial',
      '--schema=./packages/db/prisma/schema.prisma',
    ]);

    console.log('✅ Initial migration reset completed successfully!');
  } catch (error) {
    console.error('❌ Error resetting initial migration:', error.message);
    process.exit(1);
  }
}

resetInitialMigration();
