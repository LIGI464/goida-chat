import { HttpError } from '../lib/http.js';
import { valkey } from '../lib/valkey.js';

// Shared across HTTP, reconnects and tabs. INCR + expiration are atomic.
export async function consumeGuestRateLimit(key: string, max: number, windowMs = 60_000) {
  const count = await valkey.eval(
    `local count = redis.call('INCR', KEYS[1])
     if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
     return count`,
    1, `guest:rate:${key}`, windowMs,
  );
  if (Number(count) > max) throw new HttpError(429, 'Слишком много запросов. Попробуй позже.');
}
