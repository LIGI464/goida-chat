import type { FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import {
  addChatMemberSchema,
  chatIdParamsSchema,
  createDirectChatSchema,
  createGroupChatSchema,
  messageTextSchema,
  paginationQuerySchema,
} from '@goida-chat/shared';

import { badRequest, notFound } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { requireSession } from '../lib/session.js';
import {
  chatInclude,
  createTextMessage,
  ensureChatMember,
  ensureVoiceRoom,
  messageSelect,
  serializeChat,
  serializeMessage,
} from '../services/chat.js';

export async function registerChatRoutes(app: FastifyInstance, io: SocketServer) {
  app.get('/chats', async (request) => {
    const session = await requireSession(request);
    const chats = await prisma.chat.findMany({
      where: { members: { some: { userId: session.user.id } } },
      orderBy: { updatedAt: 'desc' },
      include: chatInclude,
    });

    return { chats: chats.map((chat) => serializeChat(chat, session.user.id)) };
  });

  app.post('/chats/direct', async (request) => {
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
      return { chat: serializeChat(existing, session.user.id) };
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

    return { chat: serializeChat(chat, session.user.id) };
  });

  app.post('/chats/group', async (request) => {
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

    return { chat: serializeChat(chat, session.user.id) };
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

    return { chat: serializeChat(chat, session.user.id) };
  });

  app.post('/chats/:chatId/members', async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    const body = addChatMemberSchema.parse(request.body);
    await ensureChatMember(session.user.id, params.chatId);

    const chat = await prisma.chat.findUnique({ where: { id: params.chatId } });
    if (!chat || chat.type !== 'group') throw notFound('Chat not found');

    const user = await prisma.user.findUnique({ where: { username: body.username } });
    if (!user) throw notFound('User not found');

    await prisma.chatMember.upsert({
      where: { chatId_userId: { chatId: params.chatId, userId: user.id } },
      update: {},
      create: { chatId: params.chatId, userId: user.id },
    });

    const updated = await prisma.chat.findUniqueOrThrow({
      where: { id: params.chatId },
      include: chatInclude,
    });
    io.to(`chat:${params.chatId}`).emit('chat:updated', serializeChat(updated, session.user.id));

    return { chat: serializeChat(updated, session.user.id) };
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

  app.post('/chats/:chatId/messages', async (request) => {
    const session = await requireSession(request);
    const params = chatIdParamsSchema.parse(request.params);
    const body = messageTextSchema.parse(request.body);
    const message = await createTextMessage(params.chatId, session.user.id, body.text);

    io.to(`chat:${params.chatId}`).emit('message:new', message);

    return { message };
  });
}
