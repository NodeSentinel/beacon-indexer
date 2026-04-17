import {
  createBotCommunication,
  getBotCommunication,
  markBotCommunicationSent,
  startBotCommunicationSend,
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
  startCommunicationSend: startBotCommunicationSend,
  setNotificationDelivered: markBotNotificationDelivered,
  users: listBotUsers,
  updateMessageId: updateBotUserMessageId,
  setBlocked: setBotUserBlocked,
  setUnblocked: setBotUserUnblocked,
};
