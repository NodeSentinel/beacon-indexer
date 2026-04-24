import {
  createBotCommunication,
  getBotCommunication,
  markBotCommunicationSent,
} from './communications.js';
import {
  listBotIncidentNotifications,
  markBotIncidentClosedNotified,
  markBotIncidentOpenedNotified,
} from './incident-notifications.js';
import {
  deleteBotNotification,
  listBotNotifications,
  markBotNotificationDelivered,
} from './notifications.js';
import {
  listBotUsers,
  setBotUserBlocked,
  setBotUserUnblocked,
  updateBotUserMessageId,
} from './users.js';

export const botRouter = {
  createCommunication: createBotCommunication,
  deleteNotification: deleteBotNotification,
  getCommunication: getBotCommunication,
  incidentNotifications: listBotIncidentNotifications,
  notifications: listBotNotifications,
  setIncidentClosedNotified: markBotIncidentClosedNotified,
  setIncidentOpenedNotified: markBotIncidentOpenedNotified,
  markCommunicationSent: markBotCommunicationSent,
  setNotificationDelivered: markBotNotificationDelivered,
  users: listBotUsers,
  updateMessageId: updateBotUserMessageId,
  setBlocked: setBotUserBlocked,
  setUnblocked: setBotUserUnblocked,
};
