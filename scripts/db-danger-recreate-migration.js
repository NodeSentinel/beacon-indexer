#!/usr/bin/env node

// Script to delete migrations and create a fresh initial migration (DEV ONLY)
import { spawn } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { URL } from 'url';

import { config } from 'dotenv';

// Load environment variables from packages/db/.env
config({ path: new URL('../packages/db/.env', import.meta.url) });
console.log('Environment variables loaded from packages/db/.env');

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

async function recreateInitialMigration() {
  try {
    // Run safety checks first
    checkProductionSafety();

    const migrationsDir = './packages/db/prisma/migrations';
    const migrationLockFile = join(migrationsDir, 'migration_lock.toml');

    console.log('🗑️  Step 1: Deleting existing migrations and resetting database...');
    if (existsSync(migrationsDir)) {
      // Delete all migration directories but keep migration_lock.toml
      const files = await readdir(migrationsDir);
      for (const file of files) {
        const filePath = join(migrationsDir, file);
        if (file !== 'migration_lock.toml') {
          rmSync(filePath, { recursive: true, force: true });
          console.log(`   Deleted: ${file}`);
        }
      }
    }

    // After deleting migrations, reset the database which will leave it empty
    console.log('   Resetting database to clean state...');
    try {
      await executeCommand('npx', [
        'prisma',
        'migrate',
        'reset',
        '--force',
        '--skip-generate',
        '--skip-seed',
        '--schema=./packages/db/prisma/schema.prisma',
      ]);
    } catch (error) {
      // migrate reset might fail if there are no migrations, that's OK
      // we just want to drop all tables
      console.log('   Note: migrate reset encountered an issue, but continuing...');
    }

    console.log('✨ Step 2: Creating and applying new initial migration...');
    await executeCommand('npx', [
      'prisma',
      'migrate',
      'dev',
      '--name',
      'initial',
      '--schema=./packages/db/prisma/schema.prisma',
    ]);

    console.log('✅ Initial migration recreated and applied successfully!');
    console.log('💡 Database has been reset to a clean state with the new initial migration.');
    console.log('💡 Prisma Client has been generated automatically.');
  } catch (error) {
    console.error('❌ Error recreating initial migration:', error.message);
    process.exit(1);
  }
}

recreateInitialMigration();
