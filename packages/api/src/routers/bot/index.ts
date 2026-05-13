import { createBotCommunicationsRoutes } from './communications.js';
import { createBotIncidentNotificationRoutes } from './incident-notifications.js';
import { createBotNotificationRoutes } from './notifications.js';
import { createBotUsersRoutes } from './users.js';
import type { ApiDependencies } from '@/dependencies.js';

/**
 * Creates the bot router.
 */
export function createBotRouter(
  deps: Pick<
    ApiDependencies,
    | 'botCommunicationsStorage'
    | 'botIncidentNotificationsStorage'
    | 'botNotificationsStorage'
    | 'botUsersStorage'
    | 'procedures'
  >,
) {
  const communications = createBotCommunicationsRoutes(deps);
  const incidentNotifications = createBotIncidentNotificationRoutes(deps);
  const notifications = createBotNotificationRoutes(deps);
  const users = createBotUsersRoutes(deps);

  return {
    createCommunication: communications.createBotCommunication,
    communications: communications.listBotCommunications,
    deleteNotification: notifications.deleteBotNotification,
    getCommunication: communications.getBotCommunication,
    incidentNotifications: incidentNotifications.listBotIncidentNotifications,
    notifications: notifications.listBotNotifications,
    setIncidentClosedNotified: incidentNotifications.markBotIncidentClosedNotified,
    setIncidentOpenedNotified: incidentNotifications.markBotIncidentOpenedNotified,
    markCommunicationSent: communications.markBotCommunicationSent,
    setNotificationDelivered: notifications.markBotNotificationDelivered,
    users: users.listBotUsers,
    updateMessageId: users.updateBotUserMessageId,
    setBlocked: users.setBotUserBlocked,
    setUnblocked: users.setBotUserUnblocked,
  };
}
