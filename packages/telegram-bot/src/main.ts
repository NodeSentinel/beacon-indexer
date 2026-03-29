#!/usr/bin/env tsx

import process from 'node:process';

import type { RunnerHandle } from '@grammyjs/runner';
import { run } from '@grammyjs/runner';

import { createBot } from '@/src/bot/index.js';
import type { PollingConfig, WebhookConfig } from '@/src/config.js';
import { config } from '@/src/config.js';
import { logger } from '@/src/logger.js';
import { createServer, createServerManager } from '@/src/server/index.js';

async function startPolling(config: PollingConfig) {
  const bot = createBot(config.botToken, {
    config,
    logger,
  });
  await Promise.all([bot.init(), bot.api.deleteWebhook()]);

  const runner: RunnerHandle = run(bot, {
    runner: {
      fetch: {
        allowed_updates: config.botAllowedUpdates,
      },
    },
  });

  // graceful shutdown
  onShutdown(async () => {
    logger.info('Shutdown');
    await runner.stop();
  });

  logger.info({
    msg: 'Bot running...',
    username: bot.botInfo.username,
  });
}

async function startWebhook(config: WebhookConfig) {
  const bot = createBot(config.botToken, {
    config,
    logger,
  });
  const server = createServer({
    bot,
    config,
    logger,
  });
  const serverManager = createServerManager(server, {
    host: config.serverHost,
    port: config.serverPort,
  });

  // graceful shutdown
  onShutdown(async () => {
    logger.info('Shutdown');
    await serverManager.stop();
  });

  // to prevent receiving updates before the bot is ready
  await bot.init();

  // start server
  const info = await serverManager.start();
  logger.info({
    msg: 'Server started',
    url: info.url,
  });

  // set webhook
  await bot.api.setWebhook(config.botWebhook, {
    allowed_updates: config.botAllowedUpdates,
    secret_token: config.botWebhookSecret,
  });
  logger.info({
    msg: 'Webhook was set',
    url: config.botWebhook,
  });
}

async function main() {
  if (config.isWebhookMode) await startWebhook(config);
  else if (config.isPollingMode) await startPolling(config);
}

void main().catch((error) => {
  logger.error(error);
  process.exit(1);
});

// Utils

function onShutdown(cleanUp: () => Promise<void>) {
  let isShuttingDown = false;

  const handleShutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    await cleanUp();
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}
