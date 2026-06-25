import type { FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import {
  addChatMemberSchema,
  chatIdParamsSchema,
  createDirectChatSchema,
  createGroupChatSchema,
  messageTextSchema,
  paginationQuerySchema,
  renameChatSchema,
} from '@goida-chat/shared';

import { badRequest, notFound } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { requireSession } from '../lib/session.js';
import { valkey } from '../lib/valkey.js';
import {
  chatInclude,
  createTextMessage,
  ensureChatMember,
  ensureVoiceRoom,
  type ChatWithDetails,
  messageSelect,
  serializeChat,
  serializeMessage,
} from '../services/chat.js';
import { getOnlineUserIds } from '../services/presence.js';

async function unreadCount(chatId: string, userId: string) {
  const membership = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { lastReadMessageId: true },
  });

  if (!membership) return 0;

  const latest = await prisma.message.findFirst({
    where: { chatId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });

  if (!latest) return 0;
  if (!membership.lastReadMessageId) {
    return prisma.message.count({ where: { chatId, userId: { not: userId } } });
  }

  if (membership.lastReadMessageId === latest.id) {
    return 0;
  }

  const read = await prisma.message.findUnique({
    where: { id: membership.lastReadMessageId },
    select: { createdAt: true },
  });

  if (!read) {
    return prisma.message.count({ where: { chatId, userId: { not: userId } } });
  }

  return prisma.message.count({
    where: {
      chatId,
      userId: { not: userId },
      createdAt: { gt: read.createdAt },
    },
  });
}

async function enrichChat(chat: ChatWithDetails, userId: string) {
  const base = serializeChat(chat, userId);
  return {
    ...base,
    unreadCount: await unreadCount(chat.id, userId),
    onlineMemberIds: await getOnlineUserIds(chat.members.map((member) => member.userId)),
  };
}

async function enrichChats(chats: ChatWithDetails[], userId: string) {
  return Promise.all(chats.map((chat) => enrichChat(chat, userId)));
}

export async function registerChatRoutes(app: FastifyInstance, io: SocketServer) {
  function invalidateChatLists(userIds: string[]) {
    for (const userId of new Set(userIds)) {
      io.to(`user:${userId}`).emit('chat:list:invalidate');
    }
  }

  async function invalidateChatMembers(chatId: string) {
    const members = await prisma.chatMember.findMany({
      where: { chatId },
      select: { userId: true },
    });
    invalidateChatLists(members.map((member) => member.userId));
  }

  app.get('/chats', async (request) => {
    const session = await requireSession(request);
    const chats = await prisma.chat.findMany({
      where: { members: { some: { userId: session.user.id } } },
      orderBy: { updatedAt: 'desc' },
      include: chatInclude,
    });

    return { chats: await enrichChats(chats, session.user.id) };
  });

  app.post('/chats/direct', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const session = await requireSession(request);
    const body = createDirectChatSchema.parse(request.body);
    const target = await prisma.user.findUnique({ where: { username: body.username } });

    if (!target || target.id === session.user.id) {
      throw notFound('User not found');
    }

    const existing = await prisma.chat.findFirst({
      where: {
        type: 'direct',
        AND: [
          { members: { some: { userId: session.user.id } } },
          { members: { some: { userId: target.id } } },
        ],
      },
      include: chatInclude,
    });

    if (existing) {
      await ensureVoiceRoom(existing.id);
      return { chat: await enrichChat(existing, session.user.id) };
    }

    const chat = await prisma.$transaction(async (tx) => {
      const created = await tx.chat.create({
        data: {
          type: 'direct',
          createdById: session.user.id,
          members: {
            create: [{ userId: session.user.id }, { userId: target.id }],
          },
        },
      });
      await tx.voiceRoom.create({
        data: { chatId: created.id, livekitRoomName: `chat_${created.id}_voice` },
      });
      return tx.chat.findUniqueOrThrow({ where: { id: created.id }, include: chatInclude });
    });

    invalidateChatLists([session.user.id, target.id]);
    return { chat: await enrichChat(chat, session.user.id) };
  });

  app.post('/chats/group', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const session = await requireSession(request);
    const body = createGroupChatSchema.parse(request.body);
    const uniqueUsernames = [...new Set(body.memberUsernames)].filter(
      (username) => username !== (session.user as { username?: string }).username,
    );
    const members = await prisma.user.findMany({ where: { username: { in: uniqueUsernames } } });

    if (members.length !== uniqueUsernames.length) {
      throw badRequest('Some users were not found');
    }

    const chat = await prisma.$transaction(async (tx) => {
      const created = await tx.chat.create({
        data: {
          type: 'group',
          title: body.title,
          createdById: session.user.id,
          members: {
            create: [{ userId: session.user.id }, ...members.map((user) => ({ userId: user.id }))],
          },
        },
      });
      await tx.voiceRoom.create({
        data: { chatId: created.id, livekitRoomName: `chat_${created.id}_voice` },
      });
      return tx.chat.findUniqueOrThrow({ where: { id: created.id }, include: chatInclude });
    });

    invalidateChatLists([session.user.id, ...members.map((member) => member.id)]);
    return { chat: await enrichChat(chat, session.user.id) };
  });

  app.get('/chats/:chatId', async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    const chat = await prisma.chat.findUnique({
      where: { id: params.chatId },
      include: chatInclude,
    });

    if (!chat) throw notFound('Chat not found');
    await ensureChatMember(session.user.id, params.chatId);

    return { chat: await enrichChat(chat, session.user.id) };
  });

  app.patch('/chats/:chatId', async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    const body = renameChatSchema.parse(request.body);
    await ensureChatMember(session.user.id, params.chatId);

    const chat = await prisma.chat.update({
      where: { id: params.chatId },
      data: { title: body.title },
      include: chatInclude,
    });

    io.to(`chat:${params.chatId}`).emit('chat:updated', await enrichChat(chat, session.user.id));
    invalidateChatLists(chat.members.map((member) => member.userId));

    return { chat: await enrichChat(chat, session.user.id) };
  });

  app.post('/chats/:chatId/read', async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    await ensureChatMember(session.user.id, params.chatId);

    const latest = await prisma.message.findFirst({
      where: { chatId: params.chatId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!latest) {
      return { ok: true };
    }

    await prisma.chatMember.update({
      where: { chatId_userId: { chatId: params.chatId, userId: session.user.id } },
      data: { lastReadMessageId: latest.id },
    });

    invalidateChatLists([session.user.id]);
    return { ok: true };
  });

  app.post('/chats/:chatId/typing/start', async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    await ensureChatMember(session.user.id, params.chatId);
    await valkey.sadd(`typing:${params.chatId}`, session.user.id);

    io.to(`chat:${params.chatId}`).emit('typing:update', {
      chatId: params.chatId,
      userIds: await valkey.smembers(`typing:${params.chatId}`),
    });

    return { ok: true };
  });

  app.post('/chats/:chatId/typing/stop', async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    await ensureChatMember(session.user.id, params.chatId);
    await valkey.srem(`typing:${params.chatId}`, session.user.id);

    io.to(`chat:${params.chatId}`).emit('typing:update', {
      chatId: params.chatId,
      userIds: await valkey.smembers(`typing:${params.chatId}`),
    });

    return { ok: true };
  });

  app.post('/chats/:chatId/members', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    const body = addChatMemberSchema.parse(request.body);
    await ensureChatMember(session.user.id, params.chatId);

    const chat = await prisma.chat.findUnique({ where: { id: params.chatId } });
    if (!chat || chat.type !== 'group') throw notFound('Chat not found');

    const user = await prisma.user.findUnique({ where: { username: body.username } });
    if (!user) throw notFound('User not found');
    if (user.id === session.user.id) throw badRequest('User is already in this chat');

    const existingMember = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: params.chatId, userId: user.id } },
    });
    if (existingMember) throw badRequest('User is already in this chat');

    await prisma.chatMember.create({
      data: { chatId: params.chatId, userId: user.id },
    });

    const updated = await prisma.chat.findUniqueOrThrow({
      where: { id: params.chatId },
      include: chatInclude,
    });

    io.to(`chat:${params.chatId}`).emit('chat:updated', await enrichChat(updated, session.user.id));
    invalidateChatLists(updated.members.map((member) => member.userId));

    return { chat: await enrichChat(updated, session.user.id) };
  });

  app.delete('/chats/:chatId/members/me', async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    await ensureChatMember(session.user.id, params.chatId);

    const chat = await prisma.chat.findUniqueOrThrow({
      where: { id: params.chatId },
      include: { members: true },
    });

    if (chat.type === 'direct') throw badRequest('Direct chat cannot be left');

    await prisma.chatMember.delete({
      where: { chatId_userId: { chatId: params.chatId, userId: session.user.id } },
    });

    const remaining = await prisma.chat.findUnique({
      where: { id: params.chatId },
      include: chatInclude,
    });

    invalidateChatLists(chat.members.map((member) => member.userId));
    if (!remaining) return { ok: true };

    io.to(`chat:${params.chatId}`).emit('chat:updated', await enrichChat(remaining, session.user.id));
    return { ok: true };
  });

  app.get('/chats/:chatId/messages', async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    const query = paginationQuerySchema.parse(request.query);
    await ensureChatMember(session.user.id, params.chatId);

    const messages = await prisma.message.findMany({
      where: { chatId: params.chatId },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: messageSelect,
    });
    const hasMore = messages.length > query.limit;
    const page = hasMore ? messages.slice(0, query.limit) : messages;
    const ordered = [...page].reverse().map(serializeMessage);

    return {
      messages: ordered,
      nextCursor: hasMore ? page[page.length - 1]?.id : null,
    };
  });

  app.post('/chats/:chatId/messages', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    const body = messageTextSchema.parse(request.body);
    const message = await createTextMessage(params.chatId, session.user.id, body.text);

    io.to(`chat:${params.chatId}`).emit('message:new', message);
    await invalidateChatMembers(params.chatId);

    return { message };
  });
}
