import { RoomServiceClient, TwirpError } from 'livekit-server-sdk';
import type { FastifyInstance } from 'fastify';
import { env } from '../config.js';
import { prisma } from '../lib/prisma.js';
import type { GuestPrincipal } from '../lib/principal.js';
import { livekitRoomName } from './chat.js';
import { valkey } from '../lib/valkey.js';

const EXPIRATIONS_KEY = 'guest:voice:expirations';
type VoiceGuest = Pick<GuestPrincipal, 'id' | 'chatId' | 'session'>;

function queueEntry(guest: VoiceGuest) {
  return JSON.stringify({ id: guest.id, chatId: guest.chatId, session: { id: guest.session.id } });
}

export async function trackGuestVoiceExpiry(guest: GuestPrincipal) {
  await valkey.zadd(EXPIRATIONS_KEY, guest.session.expiresAt.getTime(), queueEntry(guest));
}

export async function removeExpiredGuestVoice(guest: VoiceGuest) {
  const active = await prisma.guestSession.findFirst({
    where: { id: guest.session.id, expiresAt: { gt: new Date() } },
  });
  if (active) return;
  if (await valkey.zscore(EXPIRATIONS_KEY, queueEntry(guest)) === null) return;
  await valkey.zadd(EXPIRATIONS_KEY, Date.now(), queueEntry(guest));
  const url = env.LIVEKIT_URL.replace(/^ws/u, 'http');
  const rooms = new RoomServiceClient(url, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { requestTimeout: 5 });
  try {
    await rooms.removeParticipant(livekitRoomName(guest.chatId), guest.id);
  } catch (error) {
    if (!(error instanceof TwirpError && (error.status === 404 || error.code === 'not_found'))) throw error;
  }
  await valkey.zrem(EXPIRATIONS_KEY, queueEntry(guest));
}

// LiveKit JWT expiry controls joining, not the lifetime of an established call.
// The persisted queue also covers API restarts and clients without a Socket.IO connection.
export function registerGuestVoiceExpiry(app: FastifyInstance) {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const entries = await valkey.zrangebyscore(EXPIRATIONS_KEY, '-inf', Date.now(), 'LIMIT', 0, 100);
      await Promise.all(entries.map(async (entry) => {
        const guest = JSON.parse(entry) as VoiceGuest;
        await removeExpiredGuestVoice(guest);
      }));
    } catch (error) {
      app.log.warn({ error }, 'guest voice expiry cleanup failed; will retry');
    } finally { running = false; }
  };
  const timer = setInterval(() => { void sweep(); }, 5_000);
  timer.unref();
  app.addHook('onReady', sweep);
  app.addHook('onClose', async () => { clearInterval(timer); });
}
