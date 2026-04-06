import { Request, Response } from 'express';

// LOCAL-ONLY mode: hardcoded local user ID
export const LOCAL_USER_ID = 1;

export function generateToken(userId: number, expire?: number) {
  // Return a static token for local-only mode
  return `local-token`;
}


export function validateToken(token: string): number {
  // Local-only mode: always return the local user ID
  return LOCAL_USER_ID;
}


export function AuthToken() {

  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const handler = descriptor.value;

    if (handler === undefined) {
      return;
    }

    descriptor.value = function (req: Request, res: Response): any {
      // Local-only mode: always authenticate as the local user
      Object.assign(req.body, {userId: LOCAL_USER_ID});
      return handler.apply(this, arguments);
    };
  };

}
