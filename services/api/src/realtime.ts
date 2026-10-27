import type { FastifyBaseLogger } from 'fastify';
import type { Server as SocketServer, Socket } from 'socket.io';
import { messageInputSchema } from '@goida-chat/shared';

import {
  getAuthorizationPrincipal,
  ensurePrincipalChatAccess,
  assertActiveGuest,
  assertGuestScope,
  type AuthorizationPrincipal,
} from './lib/principal.js';
import { consumeGuestRateLimit } from './services/guest-rate-limit.js';
import { removeExpiredGuestVoice } from './services/guest-voice.js';
import { prisma } from './lib/prisma.js';
import { createTextMessage } from './services/chat.js';
import {
  addOnlineSocket,
  addTypingPresence,
  getTypingUsers,
  removeOnlineSocket,
  removeTypingPresence,
} from './services/presence.js';
import {
  addVoicePresence,
  getVoicePresence,
  removeVoicePresence,
} from './services/voice-presence.js';

type Ack<T = unknown> = (response: { ok: true; data?: T } | { ok: false; error: string }) => void;

type AuthSocket = Socket & {
  data: {
    userId: string;
    principal: AuthorizationPrincipal;
    username?: string | null;
    voiceChats: Set<string>;
    typingChats: Set<string>;
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

async function emitTypingPresence(io: SocketServer, chatId: string) {
  const users = await getTypingUsers(chatId);
  io.to(`chat:${chatId}`).emit('typing:update', { chatId, users });
}

async function emitPresenceToRelatedUsers(io: SocketServer, userId: string, isOnline: boolean) {
  const chats = await prisma.chat.findMany({
    where: { members: { some: { userId } } },
    select: {
      members: {
        select: { userId: true },
      },
    },
  });

  const recipientIds = new Set<string>();
  for (const chat of chats) {
    for (const member of chat.members) {
      if (member.userId !== userId) {
        recipientIds.add(member.userId);
      }
    }
  }

  for (const recipientId of recipientIds) {
    io.to(`user:${recipientId}`).emit('presence:update', { userId, isOnline });
  }
}

async function invalidateChatLists(io: SocketServer, chatId: string) {
  const members = await prisma.chatMember.findMany({
    where: { chatId },
    select: { userId: true },
  });

  for (const member of members) {
    io.to(`user:${member.userId}`).emit('chat:list:invalidate');
  }
}

export function registerRealtime(io: SocketServer, log: FastifyBaseLogger) {
  const disconnectTasks = new Set<Promise<void>>();
  io.use(async (socket, next) => {
    try {
      const principal = await getAuthorizationPrincipal(socket.request.headers);

      if (!principal) return next(new Error('Unauthorized'));
      if (principal.kind === 'guest') await consumeGuestRateLimit(`connect:${principal.id}`, 10);

      socket.data.principal = principal;
      socket.data.userId = principal.id;
      socket.data.username = (principal.user as { username?: string | null }).username;
      socket.data.voiceChats = new Set<string>();
      socket.data.typingChats = new Set<string>();
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
    void socket.join(`user:${authed.data.userId}`);

    const guest = authed.data.principal.kind === 'guest' ? authed.data.principal : null;
    const expirationTimer = guest
      ? setTimeout(
          () => {
            socket.emit('session:expired');
            socket.disconnect(true);
            void invalidateChatLists(io, guest.chatId).catch((error) =>
              log.warn({ error }, 'guest list expiry update failed'),
            );
            void removeExpiredGuestVoice(guest).catch((error) =>
              log.warn({ error }, 'guest voice expiry cleanup failed'),
            );
          },
          Math.max(0, guest.session.expiresAt.getTime() - Date.now()),
        )
      : null;
    expirationTimer?.unref();
    socket.use(async (packet, next) => {
      if (!guest) return next();
      try {
        await consumeGuestRateLimit(`socket:${guest.id}`, 60);
        await assertActiveGuest(guest);
        const chatId = (packet[1] as { chatId?: unknown } | undefined)?.chatId;
        if (typeof chatId !== 'string') throw new Error('Invalid chat');
        assertGuestScope(guest, chatId);
        next();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unauthorized';
        const ack = packet[packet.length - 1];
        if (typeof ack === 'function') ack({ ok: false, error: message });
        else socket.emit('message:error', { message });
      }
    });

    void (async () => {
      const becameOnline = await addOnlineSocket(authed.data.userId, socket.id);
      if (becameOnline && !guest) {
        await emitPresenceToRelatedUsers(io, authed.data.userId, true);
      }
    })().catch((error) => log.warn({ error }, 'socket online presence failed'));

    socket.on('chat:join', async (payload: { chatId?: string }, ack?: Ack) => {
      try {
        assertSocketRateLimit(authed, 'chat:join', 120, 60_000);
        const chatId = payload.chatId ?? '';
        await ensurePrincipalChatAccess(authed.data.principal, chatId);
        await socket.join(`chat:${chatId}`);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'Cannot join chat' });
      }
    });

    socket.on('chat:leave', async (payload: { chatId?: string }, ack?: Ack) => {
      const chatId = payload.chatId ?? '';
      await socket.leave(`chat:${chatId}`);
      authed.data.typingChats.delete(chatId);
      await removeTypingPresence(chatId, authed.data.userId);
      await emitTypingPresence(io, chatId);
      ack?.({ ok: true });
    });

    socket.on('message:send', async (payload: unknown, ack?: Ack) => {
      try {
        assertSocketRateLimit(authed, 'message:send', 30, 60_000);
        const input = messageInputSchema.parse(payload);
        const message = await createTextMessage(input.chatId, authed.data.principal, input.text);
        io.to(`chat:${input.chatId}`).emit('message:new', message);
        await invalidateChatLists(io, input.chatId);
        ack?.({ ok: true, data: message });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cannot send message';
        socket.emit('message:error', { message });
        ack?.({ ok: false, error: message });
      }
    });

    socket.on('typing:start', async (payload: { chatId?: string }, ack?: Ack) => {
      try {
        assertSocketRateLimit(authed, 'typing:start', 60, 60_000);
        const chatId = payload.chatId ?? '';
        await ensurePrincipalChatAccess(authed.data.principal, chatId);
        authed.data.typingChats.add(chatId);
        await addTypingPresence(chatId, authed.data.userId);
        await emitTypingPresence(io, chatId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({
          ok: false,
          error: error instanceof Error ? error.message : 'Cannot update typing',
        });
      }
    });

    socket.on('typing:stop', async (payload: { chatId?: string }, ack?: Ack) => {
      try {
        assertSocketRateLimit(authed, 'typing:stop', 60, 60_000);
        const chatId = payload.chatId ?? '';
        authed.data.typingChats.delete(chatId);
        await removeTypingPresence(chatId, authed.data.userId);
        await emitTypingPresence(io, chatId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({
          ok: false,
          error: error instanceof Error ? error.message : 'Cannot update typing',
        });
      }
    });

    socket.on('voice:join', async (payload: { chatId?: string }, ack?: Ack) => {
      try {
        assertSocketRateLimit(authed, 'voice:join', 20, 60_000);
        const chatId = payload.chatId ?? '';
        await ensurePrincipalChatAccess(authed.data.principal, chatId);
        await addVoicePresence(chatId, authed.data.userId, socket.id);
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
        await removeVoicePresence(chatId, authed.data.userId, socket.id);
        authed.data.voiceChats.delete(chatId);
        await emitVoicePresence(io, chatId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'Cannot leave voice' });
      }
    });

    socket.on('disconnect', () => {
      const cleanup = (async () => {
        if (expirationTimer) clearTimeout(expirationTimer);
        if (guest) {
          await removeExpiredGuestVoice(guest).catch((error) =>
            log.warn({ error }, 'guest voice cleanup failed'),
          );
        }
        const becameOffline = await removeOnlineSocket(authed.data.userId, socket.id);
        if (becameOffline && !guest) {
          await emitPresenceToRelatedUsers(io, authed.data.userId, false);
        }

        await Promise.all(
          [...authed.data.voiceChats, ...authed.data.typingChats].map(async (chatId) => {
            await removeVoicePresence(chatId, authed.data.userId, socket.id);
            await removeTypingPresence(chatId, authed.data.userId);
            await emitVoicePresence(io, chatId);
            await emitTypingPresence(io, chatId);
          }),
        );
      })();
      disconnectTasks.add(cleanup);
      void cleanup
        .catch((error) => log.warn({ error }, 'socket disconnect cleanup failed'))
        .finally(() => disconnectTasks.delete(cleanup));
    });
  });
  return async () => {
    io.disconnectSockets(true);
    await Promise.allSettled([...disconnectTasks]);
  };
}
