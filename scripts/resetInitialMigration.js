#!/usr/bin/env node

// Script to reset and recreate the initial migration during development
import { spawn } from 'child_process';
import { existsSync, rmSync, readdirSync } from 'fs';
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
    console.log('🔄 Step 1: Dropping database...');
    await executeCommand('npx', [
      'prisma',
      'db',
      'push',
      '--force-reset',
      '--schema=./prisma/schema.prisma',
    ]);

    console.log('🗑️  Step 2: Removing existing migrations...');
    const migrationsDir = './prisma/migrations';
    if (existsSync(migrationsDir)) {
      const migrations = readdirSync(migrationsDir);
      migrations.forEach((migration) => {
        if (migration !== '.gitkeep') {
          const migrationPath = join(migrationsDir, migration);
          rmSync(migrationPath, { recursive: true, force: true });
          console.log(`   Removed: ${migration}`);
        }
      });
    }

    console.log('✨ Step 3: Creating new initial migration...');
    await executeCommand('npx', [
      'prisma',
      'migrate',
      'dev',
      '--name',
      'initial',
      '--schema=./prisma/schema.prisma',
    ]);

    console.log('✅ Initial migration reset completed successfully!');
  } catch (error) {
    console.error('❌ Error resetting initial migration:', error.message);
    process.exit(1);
  }
}

resetInitialMigration();
