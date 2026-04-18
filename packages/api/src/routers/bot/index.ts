import {
  createBotCommunication,
  getBotCommunication,
  markBotCommunicationSent,
} from './communications.js';
import {
  deleteBotNotification,
  listBotNotifications,
  markBotNotificationDelivered,
} from './notifications.js';
import {
  listBotUsers,
  updateBotUserMessageId,
  setBotUserBlocked,
  setBotUserUnblocked,
} from './users.js';

export const botRouter = {
  createCommunication: createBotCommunication,
  deleteNotification: deleteBotNotification,
  getCommunication: getBotCommunication,
  notifications: listBotNotifications,
  markCommunicationSent: markBotCommunicationSent,
  setNotificationDelivered: markBotNotificationDelivered,
  users: listBotUsers,
  updateMessageId: updateBotUserMessageId,
  setBlocked: setBotUserBlocked,
  setUnblocked: setBotUserUnblocked,
};
