import fs from 'fs';
import path from 'path';

import Pino, { pino } from 'pino';

// Note: We use process.env directly instead of importing from @/src/lib/env.js
// because pino.ts is a low-level infrastructure module that only needs optional
// logging configuration. Importing env.ts would require validating all blockchain
// configuration variables (CHAIN, CONSENSUS_*, EXECUTION_*, etc.) which are not
// needed for logging and would break in test environments where these variables
// may not be set. This keeps the logging module decoupled from the full app config.

// Log configuration - using process.env directly for flexibility
const LOG_OUTPUT = process.env.LOG_OUTPUT || 'console';
const logsDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

// Function to get the current day's log file name
const getCurrentLogFileName = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}-${month}-${year}.log`;
};

// Function to get the current day's error log file name
const getCurrentErrorLogFileName = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `errors-${day}-${month}-${year}.log`;
};

// Function to create a logger with optional context
const createLogger = (initialContext: string | null, enabled: boolean = true) => {
  const _initialContext = initialContext;
  // Add context state that can be modified
  let currentContext = initialContext;

  const logWithContext = (
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    ...args: unknown[]
  ) => {
    // Only skip logging if enabled is false AND it's not an error
    if (!enabled && level !== 'error') return;

    const contextualMessage = currentContext ? `[${currentContext}] ${message}` : message;

    // Only pass an object if there are additional arguments, otherwise just pass the message
    if (args.length > 0) {
      logger[level](args[0], contextualMessage);
    } else {
      logger[level](contextualMessage);
    }
  };

  return {
    // Add method to update context
    setContext: (extraContext: string) => {
      currentContext = currentContext ? `${_initialContext} - ${extraContext}` : extraContext;
    },
    info: (message: string, ...args: unknown[]) => logWithContext('info', message, ...args),
    warn: (message: string, ...args: unknown[]) => logWithContext('warn', message, ...args),
    error: (message: string, error: unknown) => {
      console.error(message, error);
      logWithContext('error', message, error);
    },
    debug: (message: string, ...args: unknown[]) => logWithContext('debug', message, ...args),
  };
};

// Update the type definition to include the new setContext method
export type CustomLogger = ReturnType<typeof createLogger>;

// Modify the logger creation to be a function
const createPinoLogger = () => {
  const targets: Pino.TransportTargetOptions[] = [];

  if (LOG_OUTPUT === 'file') {
    const logPath = path.join(logsDir, getCurrentLogFileName());
    targets.push({
      target: 'pino-pretty',
      level: process.env.LOG_LEVEL || 'info',
      options: {
        destination: logPath,
        colorize: false,
        messageFormat: '{msg}',
        ignore: 'pid,hostname',
        translateTime: 'HH:MM:ss.l',
        singleLine: true,
        hideObject: false,
      },
    });
  } else {
    targets.push({
      target: 'pino-pretty',
      level: process.env.LOG_LEVEL || 'info',
      options: {
        colorize: true,
        messageFormat: '{msg}',
        ignore: 'pid,hostname',
        translateTime: 'HH:MM:ss.l',
        singleLine: true,
        hideObject: false,
      },
    });
  }

  // Always write errors to a separate file for post-mortem debugging
  const errorLogPath = path.join(logsDir, getCurrentErrorLogFileName());
  targets.push({
    target: 'pino-pretty',
    level: 'error',
    options: {
      destination: errorLogPath,
      colorize: false,
      messageFormat: '{msg}',
      ignore: 'pid,hostname',
      translateTime: 'HH:MM:ss.l',
      singleLine: true,
      hideObject: false,
    },
  });

  return pino({
    level: process.env.LOG_LEVEL || 'info',
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    base: null,
    transport: { targets },
  });
};

// Ensure the logs directory exists before creating the logger
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create the initial logger
let logger = createPinoLogger();

// Function to rotate logs daily
const rotateLogsDaily = () => {
  logger = createPinoLogger();
  console.log('Log rotated to new file:', getCurrentLogFileName());
};

// Calculate milliseconds until midnight
const msUntilMidnight = () => {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight.getTime() - now.getTime();
};

// Set up daily log rotation at midnight
setTimeout(() => {
  rotateLogsDaily();
  setInterval(rotateLogsDaily, 24 * 60 * 60 * 1000);
}, msUntilMidnight());

export default createLogger;
