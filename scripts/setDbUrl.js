#!/usr/bin/env node

// Script to build DATABASE_URL from PostgreSQL environment variables
import { spawn } from 'child_process';

import { config } from 'dotenv';

// Load environment variables
config();

const {
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_HOST,
  POSTGRES_PORT = '5432',
  POSTGRES_DB,
} = process.env;

const isDocker = process.env.DOCKER_ENV === 'true';
const host = isDocker ? 'postgres' : POSTGRES_HOST || 'localhost';
const DATABASE_URL = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${host}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public`;

// Set DATABASE_URL in process.env
process.env.DATABASE_URL = DATABASE_URL;

console.log('🔗 DATABASE_URL constructed:', DATABASE_URL.replace(/:([^:@]+)@/, ':***@'));

// Get command and arguments
const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error('❌ No command provided');
  console.error('Usage: node set-db-url.js <command> [args...]');
  process.exit(1);
}

// Execute the command
const child = spawn(command, args, {
  stdio: 'inherit',
  shell: true,
  cwd: process.cwd(), // Use current working directory
});

child.on('close', (code) => {
  process.exit(code);
});

child.on('error', (error) => {
  console.error('❌ Error executing command:', error.message);
  process.exit(1);
});
