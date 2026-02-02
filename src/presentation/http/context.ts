import type { Context } from 'hono';
import type { ServiceContainer } from '../../common/context';

export const getContainer = (c: Context): ServiceContainer =>
  c.get('container') as ServiceContainer;

export const getUserId = (c: Context): number => {
  const userId = c.get('userId') as number | undefined;
  if (!userId) {
    throw new Error('User context missing. Ensure authentication middleware is applied.');
  }
  return userId;
};
