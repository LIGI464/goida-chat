import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { chatIdParamsSchema } from '@goida-chat/shared';
import { prisma } from '../lib/prisma.js';
import { requireSession } from '../lib/session.js';
import { ensureChatMember } from '../services/chat.js';
import { badRequest, notFound } from '../lib/http.js';

export async function registerInviteRoutes(app: FastifyInstance) {
  app.post('/chats/:chatId/invites', async (request) => {
    const session = await requireSession(request);
    const { chatId } = chatIdParamsSchema.parse(request.params);
    await ensureChatMember(session.user.id, chatId);
    const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { type: true } });
    if (!chat || chat.type !== 'group') throw badRequest('Invites are available for group chats only');
    const invite = await prisma.chatInvite.create({
      data: { token: randomBytes(24).toString('base64url'), chatId, createdById: session.user.id },
    });
    return { token: invite.token, url: `/invite/${invite.token}` };
  });

  app.post('/invites/:token/join', async (request) => {
    const session = await requireSession(request);
    const token = String((request.params as { token?: string }).token ?? '');
    const invite = await prisma.chatInvite.findUnique({ where: { token } });
    if (!invite || (invite.expiresAt && invite.expiresAt <= new Date())) throw notFound('Invite not found or expired');
    await prisma.chatMember.upsert({ where: { chatId_userId: { chatId: invite.chatId, userId: session.user.id } }, update: {}, create: { chatId: invite.chatId, userId: session.user.id } });
    return { chatId: invite.chatId };
  });
}
