import { env } from './config/env.js';
import { startJobs, stopJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';
import { getPrisma, disconnectPrisma } from './lib/prisma.js';
import { createHttpServer } from './server.js';

let server: ReturnType<typeof createHttpServer> | null = null;

// Cleanup function to ensure proper shutdown
async function cleanup() {
  logger.info('Starting graceful shutdown...');

  try {
    // Stop cron jobs
    stopJobs();

    // Close HTTP server
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      logger.info('HTTP server closed');
    }

    // Disconnect Prisma
    await disconnectPrisma();
  } catch (error) {
    logger.error({ err: error }, 'Error during cleanup');
  }

  logger.info('Shutdown complete');
}

// Handle graceful shutdown signals
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  await cleanup();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', async (error) => {
  logger.error({ err: error }, 'Uncaught exception');
  await cleanup();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  logger.error({ promise, reason }, 'Unhandled rejection');
  await cleanup();
  process.exit(1);
});

async function main() {
  try {
    // Connect to database
    const prisma = getPrisma();
    await prisma.$connect();
    logger.info('Database connected successfully');

    // Start HTTP server
    server = createHttpServer();
    await new Promise<void>((resolve, reject) => {
      server!.listen(env.PORT, '0.0.0.0', () => {
        logger.info(`HTTP server listening on port ${env.PORT}`);
        resolve();
      });

      server!.on('error', (err) => {
        reject(err);
      });
    });

    // Start cron jobs
    startJobs();

    logger.info('API server started successfully');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    await cleanup();
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  cleanup()
    .then(() => {
      process.exit(1);
    })
    .catch(() => {
      process.exit(1);
    });
});
