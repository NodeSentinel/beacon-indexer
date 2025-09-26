import type { ActionArgs, EventObject, MachineContext, ParameterizedObject } from 'xstate';

import createLogger from '@/src/lib/pino.js';

// Define the log expression type that returns either string or log data object
type PinoLogExpr<
  TContext extends MachineContext,
  TExpressionEvent extends EventObject,
  TParams extends ParameterizedObject['params'] | undefined,
  TEvent extends EventObject,
> = (
  args: ActionArgs<TContext, TExpressionEvent, TEvent>,
  params: TParams,
) => string | { message: string; data?: unknown };

// Define the action interface matching XState's LogAction
export interface PinoLogAction<
  TContext extends MachineContext,
  TExpressionEvent extends EventObject,
  TParams extends ParameterizedObject['params'] | undefined,
  TEvent extends EventObject,
> {
  (args: ActionArgs<TContext, TExpressionEvent, TEvent>, params: TParams): void;
}

// Define the resolvable log value type (like XState's ResolvableLogValue)
type ResolvablePinoLogValue<
  TContext extends MachineContext,
  TExpressionEvent extends EventObject,
  TParams extends ParameterizedObject['params'] | undefined,
  TEvent extends EventObject,
> = string | PinoLogExpr<TContext, TExpressionEvent, TParams, TEvent>;

/**
 * Creates a Pino-integrated log action that works with XState
 * This provides semantic logging with proper context and event access while using Pino
 *
 * Usage:
 * - pinoLog('Simple message') - logs a simple string message (uses machine ID as context)
 * - pinoLog('Simple message', 'MyLogger') - logs with custom logger context
 * - pinoLog('Simple message', 'MyLogger', 'warn') - logs with custom context and level
 * - pinoLog((args) => 'Dynamic message') - logs a dynamic string message
 * - pinoLog((args) => ({ message: 'Dynamic', data: args.context })) - logs with dynamic data
 *
 * @param value - Either a string message or a function that returns log data
 * @param loggerContext - Context for the logger (default: uses machine ID from args.self.id)
 * @param level - The log level (default: 'info')
 * @returns An XState action function that logs through Pino
 */
export const pinoLog = <
  TContext extends MachineContext,
  TExpressionEvent extends EventObject,
  TParams extends ParameterizedObject['params'] | undefined,
  TEvent extends EventObject,
>(
  value?: ResolvablePinoLogValue<TContext, TExpressionEvent, TParams, TEvent>,
  loggerContext?: string,
  level: 'info' | 'warn' | 'error' | 'debug' = 'info',
): PinoLogAction<TContext, TExpressionEvent, TParams, TEvent> => {
  return (args: ActionArgs<TContext, TExpressionEvent, TEvent>, params: TParams) => {
    // Use machine ID as logger context if not provided
    const context = loggerContext || args.self?.id || 'XState';
    const logger = createLogger(context);
    let message: string;
    let data: unknown;

    if (typeof value === 'string') {
      // Simple string message
      message = value;
      data = { context: args.context, event: args.event };
    } else if (typeof value === 'function') {
      // Function that returns either string or log data object
      const result = value(args, params);
      if (typeof result === 'string') {
        message = result;
        // data = { context: args.context, event: args.event };
      } else {
        message = result.message;
        data = result.data;
      }
    } else {
      // Default case
      message = 'XState log';
      data = { context: args.context, event: args.event };
    }

    // Log through Pino with the specified level
    switch (level) {
      case 'info':
        logger.info(message, data);
        break;
      case 'warn':
        logger.warn(message, data);
        break;
      case 'error':
        logger.error(message, data);
        break;
      case 'debug':
        logger.debug(message, data);
        break;
    }
  };
};

/**
 * Type definitions for better TypeScript support
 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
