import { Socket } from 'socket.io';

import { User } from '../../storage';
import { LOCAL_USER_ID } from '../services/auth-token';

export async function authMiddleware(socket: Socket, next: (err?: any) => void): Promise<void> {
  // Local-only mode: always authenticate as the local user
  const user = await User.findOne(LOCAL_USER_ID);
  if (user === undefined) {
    return next(new Error('Local user not found. Server may not have initialized properly.'));
  }

  (socket as any).user = user;
  next();
}
