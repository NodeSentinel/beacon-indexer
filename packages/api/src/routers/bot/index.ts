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
  deleteNotification: deleteBotNotification,
  notifications: listBotNotifications,
  setNotificationDelivered: markBotNotificationDelivered,
  users: listBotUsers,
  updateMessageId: updateBotUserMessageId,
  setBlocked: setBotUserBlocked,
  setUnblocked: setBotUserUnblocked,
};
