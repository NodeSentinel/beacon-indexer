import type { Logger } from '@/src/logger.js';

export interface Env {
  Variables: {
    requestId: string;
    logger: Logger;
  };
}
