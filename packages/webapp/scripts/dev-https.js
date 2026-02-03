#!/usr/bin/env node

/**
 * HTTPS development server for Next.js
 * Wraps Next.js dev server with HTTPS support using local certificates
 * Only for development - production uses Vercel's HTTPS
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const https = require('https');
const path = require('path');

const next = require('next');

const dev = true;
const hostname = 'localhost';
const port = 3000;

// Paths to SSL certificates
const certDir = path.join(process.cwd(), '.cert');
const keyPath = path.join(certDir, 'localhost-key.pem');
const certPath = path.join(certDir, 'localhost.pem');

// Check if certificates exist
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('❌ SSL certificates not found!');
  console.error('Please run: pnpm cert:setup');
  process.exit(1);
}

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Get WebSocket upgrade handler for HMR (Hot Module Replacement)
const handleUpgrade = app.getUpgradeHandler ? app.getUpgradeHandler() : null;

(async () => {
  try {
    // Prepare Next.js
    await app.prepare();

    // Create HTTPS server
    const server = https.createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      (req, res) => {
        handle(req, res);
      },
    );

    // Handle WebSocket upgrade for HMR
    if (handleUpgrade) {
      server.on('upgrade', (req, socket, head) => {
        handleUpgrade(req, socket, head);
      });
    }

    // Start server
    server.listen(port, '0.0.0.0', (err) => {
      if (err) throw err;
      console.log('');
      console.log('🚀 Ready on https://localhost:' + port);
      console.log('');
      console.log('📱 For mobile testing:');
      console.log('   Use pnpm dev:tunnel to get a public HTTPS URL');
      console.log('');
    });
  } catch (error) {
    console.error('Error starting HTTPS server:', error);
    process.exit(1);
  }
})();
