import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import { Prisma } from '@prisma/client';
import {
  chatIdParamsSchema,
  createInviteSchema,
  inviteIdParamsSchema,
  inviteTokenSchema,
} from '@goida-chat/shared';
import { prisma } from '../lib/prisma.js';
import { requireSession, publicUser } from '../lib/session.js';
import { chatInclude, ensureChatMember, serializeChat } from '../services/chat.js';
import { badRequest, forbidden, notFound } from '../lib/http.js';
import { consumeInvite, lockInvite } from '../services/invite-redemption.js';

function serializeInvite(invite: {
  id: string;
  token: string;
  chatId: string;
  createdById: string;
  expiresAt: Date;
  revokedAt: Date | null;
  maxUses: number | null;
  uses: number;
  createdAt: Date;
}) {
  return {
    id: invite.id,
    token: invite.token,
    url: `/invite/${invite.token}`,
    chatId: invite.chatId,
    createdById: invite.createdById,
    expiresAt: invite.expiresAt,
    revokedAt: invite.revokedAt,
    maxUses: invite.maxUses,
    uses: invite.uses,
    remainingUses: invite.maxUses === null ? null : Math.max(invite.maxUses - invite.uses, 0),
    createdAt: invite.createdAt,
  };
}

export async function registerInviteRoutes(app: FastifyInstance, io: SocketServer) {
  app.post(
    '/chats/:chatId/invites',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const session = await requireSession(request);
      const { chatId } = chatIdParamsSchema.parse(request.params);
      const input = createInviteSchema.parse(request.body);
      await ensureChatMember(session.user.id, chatId);
      const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { type: true } });
      if (!chat || chat.type !== 'group')
        throw badRequest('Invites are available for group chats only');
      const invite = await prisma.chatInvite.create({
        data: {
          token: randomBytes(32).toString('base64url'),
          chatId,
          createdById: session.user.id,
          expiresAt: new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000),
          maxUses: input.maxUses,
        },
      });
      return serializeInvite(invite);
    },
  );

  app.get('/chats/:chatId/invites', async (request) => {
    const session = await requireSession(request);
    const { chatId } = chatIdParamsSchema.parse(request.params);
    await ensureChatMember(session.user.id, chatId);
    const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { type: true } });
    if (!chat || chat.type !== 'group') throw notFound('Chat not found');
    const invites = await prisma.chatInvite.findMany({
      where: { chatId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      invites: invites
        .filter((invite) => invite.maxUses === null || invite.uses < invite.maxUses)
        .map(serializeInvite),
    };
  });

  app.delete(
    '/chats/:chatId/invites/:inviteId',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const session = await requireSession(request);
      const { chatId, inviteId } = inviteIdParamsSchema.parse(request.params);
      await ensureChatMember(session.user.id, chatId);
      const invite = await prisma.chatInvite.findUnique({ where: { id: inviteId } });
      if (!invite || invite.chatId !== chatId) throw notFound('Invite not found');
      if (invite.createdById !== session.user.id)
        throw forbidden('Only the invite creator can revoke this invite');
      await prisma.chatInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
      return { ok: true };
    },
  );

  app.post(
    '/invites/:token/join',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const session = await requireSession(request);
      const token = inviteTokenSchema.parse(
        String((request.params as { token?: string }).token ?? ''),
      );
      const result = await prisma.$transaction(async (tx) => {
        const invite = await lockInvite(tx, token);
        // Different invites to the same room must also serialize the same user's
        // membership, otherwise two successful requests could consume two uses.
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`invite:${invite.chatId}:${session.user.id}`}, 0))`,
        );
        const existing = await tx.chatMember.findUnique({
          where: { chatId_userId: { chatId: invite.chatId, userId: session.user.id } },
        });
        if (existing) return { added: false, chatId: invite.chatId };
        await consumeInvite(tx, invite);
        await tx.chatMember.create({ data: { chatId: invite.chatId, userId: session.user.id } });
        return { added: true, chatId: invite.chatId };
      });

      const invite = result;
      if (!result.added) return { chatId: invite.chatId };
      const updated = await prisma.chat.findUniqueOrThrow({
        where: { id: invite.chatId },
        include: chatInclude,
      });
      const memberIds = updated.members.map((member) => member.userId);
      io.to(`chat:${invite.chatId}`).emit('chat:updated', serializeChat(updated, session.user.id));
      io.to(`chat:${invite.chatId}`).emit('chat:member-added', {
        chatId: invite.chatId,
        user: publicUser({
          id: session.user.id,
          name: session.user.name,
          username: (session.user as { username?: string | null }).username ?? null,
          displayUsername:
            (session.user as { displayUsername?: string | null }).displayUsername ?? null,
          image: session.user.image ?? null,
        }),
      });
      io.to(`user:${session.user.id}`).emit(
        'chat:created',
        serializeChat(updated, session.user.id),
      );
      for (const userId of new Set(memberIds)) {
        io.to(`user:${userId}`).emit('chat:updated', serializeChat(updated, userId));
        io.to(`user:${userId}`).emit('chat:list:invalidate');
      }
      return { chatId: invite.chatId };
    },
  );
}
