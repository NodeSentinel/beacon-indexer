import type { Context } from '@/src/bot/context.js';
import type { ErrorHandler } from 'grammy';

import { getUpdateInfo } from '@/src/bot/helpers/logging.js';

export const errorHandler: ErrorHandler<Context> = (error) => {
  const { ctx } = error;

  ctx.logger.error({
    err: error.error,
    update: getUpdateInfo(ctx),
  });
};
