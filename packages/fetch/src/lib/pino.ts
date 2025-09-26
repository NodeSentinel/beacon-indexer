import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import chalk from 'chalk';
import Pino, { DestinationStream, pino } from 'pino';

import { env } from '@/src/lib/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log configuration
const LOG_OUTPUT = env.LOG_OUTPUT || 'console';
const logsDir = path.join(__dirname, '../../logs');

// Function to get the current day's log file name
const getCurrentLogFileName = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}-${month}-${year}.log`;
};

// Helper function to apply color to text using chalk
const applyColor = (text: string, colorName = 'white'): string => {
  if (!colorName) return text;

  // Map color names to chalk methods
  const colorMap: Record<string, (text: string) => string> = {
    blue: chalk.blue,
    cyan: chalk.cyan,
    green: chalk.green,
    red: chalk.red,
    yellow: chalk.yellow,
    magenta: chalk.magenta,
    white: chalk.white,
    gray: chalk.gray,
  };

  const colorFn = colorMap[colorName];
  return colorFn ? colorFn(text) : text;
};

// Function to create a logger with optional context and color
const createLogger = (initialContext: string | null, enabled: boolean = true, color = 'yellow') => {
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

    // Include context in the message itself for cleaner output with optional color
    const contextualMessage = currentContext
      ? `${applyColor(`[${currentContext}]`, color)} ${applyColor(message)}`
      : applyColor(message);

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
  let logDestination: DestinationStream | undefined;
  let transport;
  if (LOG_OUTPUT === 'file') {
    const logPath = path.join(logsDir, getCurrentLogFileName());
    logDestination = Pino.destination({ dest: logPath, sync: false });
    transport = {
      target: 'pino-pretty',
      options: {
        destination: logPath,
        colorize: false, // Disable colors for file output
        messageFormat: '{msg}',
        ignore: 'pid,hostname',
        translateTime: 'HH:MM:ss.l',
        singleLine: true,
        hideObject: false,
      },
    };
  } else {
    transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        messageFormat: '{msg}',
        ignore: 'pid,hostname',
        translateTime: 'HH:MM:ss.l',
        singleLine: true,
        hideObject: false,
      },
    };
  }

  return pino(
    {
      level: env.LOG_LEVEL || 'info',
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      base: null, // This removes pid and hostname
      transport, // Use the transport configuration here
    },
    LOG_OUTPUT === 'file' ? logDestination : undefined,
  );
};

// Create the initial logger
let logger = createPinoLogger();

// Ensure the logs directory exists if file output is used
if (LOG_OUTPUT === 'file') {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// Function to rotate logs daily
const rotateLogsDaily = () => {
  if (LOG_OUTPUT === 'file') {
    // Create a new logger instance with the new file
    logger = createPinoLogger();
    console.log('Log rotated to new file:', getCurrentLogFileName());
  }
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
