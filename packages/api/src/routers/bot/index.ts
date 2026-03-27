import {
  listBotUsers,
  updateBotUserMessageId,
  setBotUserBlocked,
  setBotUserUnblocked,
} from './users.js';

export const botRouter = {
  users: listBotUsers,
  updateMessageId: updateBotUserMessageId,
  setBlocked: setBotUserBlocked,
  setUnblocked: setBotUserUnblocked,
};
