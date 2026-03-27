import { anonymousUser } from './anonymous.js';
import { me } from './me.js';

export const userRouter = {
  anonymous: anonymousUser,
  me,
};
