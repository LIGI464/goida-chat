import type { FastifyBaseLogger } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { Server as SocketServer, Socket } from 'socket.io';
import { messageInputSchema } from '@goida-chat/shared';

import { auth } from './auth.js';
import { ensureChatMember, createTextMessage } from './services/chat.js';
import {
  addVoicePresence,
  getVoicePresence,
  removeVoicePresence,
} from './services/voice-presence.js';

type Ack<T = unknown> = (response: { ok: true; data?: T } | { ok: false; error: string }) => void;

type AuthSocket = Socket & {
  data: {
    userId: string;
    username?: string | null;
    voiceChats: Set<string>;
    rateLimits: Map<string, { count: number; resetAt: number }>;
  };
};

function assertSocketRateLimit(socket: AuthSocket, key: string, max: number, windowMs: number) {
  const now = Date.now();
  const existing = socket.data.rateLimits.get(key);

  if (!existing || existing.resetAt <= now) {
    socket.data.rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  existing.count += 1;
  if (existing.count > max) {
    throw new Error('Too many requests. Slow down a bit.');
  }
}

async function emitVoicePresence(io: SocketServer, chatId: string) {
  const users = await getVoicePresence(chatId);
  io.to(`chat:${chatId}`).emit('voice:presence:update', { chatId, users });
}

export function registerRealtime(io: SocketServer, log: FastifyBaseLogger) {
  io.use(async (socket, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(socket.request.headers),
      });

      if (!session) return next(new Error('Unauthorized'));

      socket.data.userId = session.user.id;
      socket.data.username = (session.user as { username?: string | null }).username;
      socket.data.voiceChats = new Set<string>();
      socket.data.rateLimits = new Map<string, { count: number; resetAt: number }>();
      return next();
    } catch (error) {
      log.warn({ error }, 'socket auth failed');
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const authed = socket as AuthSocket;
    log.debug({ socketId: socket.id, userId: authed.data.userId }, 'socket connected');

    socket.on('chat:join', async (payload: { chatId?: string }, ack?: Ack) => {
      try {
        assertSocketRateLimit(authed, 'chat:join', 120, 60_000);
        const chatId = payload.chatId ?? '';
        await ensureChatMember(authed.data.userId, chatId);
        await socket.join(`chat:${chatId}`);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'Cannot join chat' });
      }
    });

    socket.on('chat:leave', async (payload: { chatId?: string }, ack?: Ack) => {
      const chatId = payload.chatId ?? '';
      await socket.leave(`chat:${chatId}`);
      ack?.({ ok: true });
    });

    socket.on('message:send', async (payload: unknown, ack?: Ack) => {
      try {
        assertSocketRateLimit(authed, 'message:send', 30, 60_000);
        const input = messageInputSchema.parse(payload);
        const message = await createTextMessage(input.chatId, authed.data.userId, input.text);
        io.to(`chat:${input.chatId}`).emit('message:new', message);
        ack?.({ ok: true, data: message });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cannot send message';
        socket.emit('message:error', { message });
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('voice:join', async (payload: { chatId?: string }, ack?: Ack) => {
      try {
        assertSocketRateLimit(authed, 'voice:join', 20, 60_000);
        const chatId = payload.chatId ?? '';
        await ensureChatMember(authed.data.userId, chatId);
        await addVoicePresence(chatId, authed.data.userId);
        authed.data.voiceChats.add(chatId);
        await emitVoicePresence(io, chatId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'Cannot join voice' });
      }
    });

    socket.on('voice:left', async (payload: { chatId?: string }, ack?: Ack) => {
      try {
        assertSocketRateLimit(authed, 'voice:left', 20, 60_000);
        const chatId = payload.chatId ?? '';
        await removeVoicePresence(chatId, authed.data.userId);
        authed.data.voiceChats.delete(chatId);
        await emitVoicePresence(io, chatId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'Cannot leave voice' });
      }
    });

    socket.on('disconnect', async () => {
      await Promise.all(
        [...authed.data.voiceChats].map(async (chatId) => {
          await removeVoicePresence(chatId, authed.data.userId);
          await emitVoicePresence(io, chatId);
        }),
      );
    });
  });
}
