import type { FastifyInstance } from 'fastify';
import { chatIdParamsSchema } from '@goida-chat/shared';
import { AccessToken } from 'livekit-server-sdk';

import { env } from '../config.js';
import { requirePrincipal, ensurePrincipalChatAccess } from '../lib/principal.js';
import { ensureVoiceRoom } from '../services/chat.js';
import { getVoicePresence } from '../services/voice-presence.js';
import { trackGuestVoiceExpiry } from '../services/guest-voice.js';

export async function registerVoiceRoutes(app: FastifyInstance) {
  app.post(
    '/chats/:chatId/voice/token',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const session = await requirePrincipal(request);
      const params = chatIdParamsSchema.parse(request.params);
      await ensurePrincipalChatAccess(session, params.chatId);
      const voiceRoom = await ensureVoiceRoom(params.chatId);
      if (session.kind === 'guest') await trackGuestVoiceExpiry(session);
      const user = session.user as { id: string; username?: string | null; name?: string | null };

      const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity: user.id,
        name: user.username ?? user.name ?? user.id,
        ttl: session.kind === 'guest'
          ? Math.max(1, Math.floor((session.session.expiresAt.getTime() - Date.now()) / 1000))
          : '6h',
        metadata: JSON.stringify({
          userId: user.id,
          username: user.username ?? user.name ?? user.id,
        }),
      });
      token.addGrant({
        room: voiceRoom.livekitRoomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      return {
        token: await token.toJwt(),
        url: env.LIVEKIT_URL,
        roomName: voiceRoom.livekitRoomName,
      };
    },
  );

  app.get(
    '/chats/:chatId/voice/presence',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const session = await requirePrincipal(request);
      const params = chatIdParamsSchema.parse(request.params);
      await ensurePrincipalChatAccess(session, params.chatId);

      return { users: await getVoicePresence(params.chatId) };
    },
  );
}
