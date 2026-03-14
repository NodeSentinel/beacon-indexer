import type { ActionArgs, EventObject, MachineContext, ParameterizedObject } from 'xstate';

import { env } from '@/src/lib/env.js';
import { sendTelegramAlert } from '@/src/lib/telegram.js';

type TelegramErrorExpr<
  TContext extends MachineContext,
  TExpressionEvent extends EventObject,
  TParams extends ParameterizedObject['params'] | undefined,
  TEvent extends EventObject,
> = (args: ActionArgs<TContext, TExpressionEvent, TEvent>, params: TParams) => string;

/**
 * Creates an XState action that sends a Telegram alert on error.
 * Follows the same pattern as pinoLog — pass a string or expression function.
 *
 * @param value - A string or function returning the error description
 * @param loggerContext - Machine/state identifier for the alert header
 */
export const sendTelegramError = <
  TContext extends MachineContext,
  TExpressionEvent extends EventObject,
  TParams extends ParameterizedObject['params'] | undefined,
  TEvent extends EventObject,
>(
  value: string | TelegramErrorExpr<TContext, TExpressionEvent, TParams, TEvent>,
  loggerContext: string,
) => {
  return (args: ActionArgs<TContext, TExpressionEvent, TEvent>, params: TParams) => {
    const message = typeof value === 'function' ? value(args, params) : value;
    const chain = env.CHAIN;

    const text = `<b>[${chain.toUpperCase()}] ${loggerContext}</b>\n\n${message}`;

    void sendTelegramAlert(text);
  };
};
