import { createAnonymousUserRoute } from './anonymous.js';
import { createMeRoute } from './me.js';

/**
 * Creates the user router.
 */
export function createUserRouter(params: {
  procedures: Parameters<typeof createAnonymousUserRoute>[0]['procedures'];
  userStorage: Parameters<typeof createAnonymousUserRoute>[0]['userStorage'];
}) {
  return {
    anonymous: createAnonymousUserRoute(params),
    me: createMeRoute(params),
  };
}
