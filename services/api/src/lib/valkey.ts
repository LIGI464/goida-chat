import { Redis } from 'ioredis';

import { env } from '../config.js';

export const valkey = new Redis(env.VALKEY_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});
