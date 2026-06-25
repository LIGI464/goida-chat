import type { FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import { updateProfileSchema } from '@goida-chat/shared';

import { badRequest } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { requireSession, publicUser } from '../lib/session.js';
import { publicUserSelect } from '../services/chat.js';

export async function registerUserRoutes(app: FastifyInstance, io: SocketServer) {
  app.get(
    '/users/search',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const session = await requireSession(request);
      const rawQuery = ((request.query as { username?: string }).username ?? '').trim();
      const normalizedQuery = rawQuery.replace(/^@+/, '').toLowerCase();

      if (normalizedQuery.length < 2) {
        return { users: [] };
      }

      const users = await prisma.user.findMany({
        where: {
          id: { not: session.user.id },
          OR: [
            { username: { contains: normalizedQuery, mode: 'insensitive' } },
            { displayUsername: { contains: normalizedQuery, mode: 'insensitive' } },
            { name: { contains: rawQuery.replace(/^@+/, ''), mode: 'insensitive' } },
          ],
        },
        orderBy: { username: 'asc' },
        take: 10,
        select: publicUserSelect,
      });

      return { users: users.map(publicUser) };
    },
  );

  app.patch(
    '/users/me',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const session = await requireSession(request);
      const body = updateProfileSchema.parse(request.body);
      const currentUser = session.user as { username?: string | null; name?: string | null };

      if (body.username === currentUser.username) {
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: session.user.id },
          select: publicUserSelect,
        });
        return { user: publicUser(user) };
      }

      const existing = await prisma.user.findUnique({
        where: { username: body.username },
        select: { id: true },
      });

      if (existing && existing.id !== session.user.id) {
        throw badRequest('Username is already taken');
      }

      const updateData: {
        username: string;
        displayUsername: string;
        name?: string;
      } = {
        username: body.username,
        displayUsername: body.username,
      };

      if (!currentUser.name || currentUser.name === currentUser.username) {
        updateData.name = body.username;
      }

      const user = await prisma.user.update({
        where: { id: session.user.id },
        data: updateData,
        select: publicUserSelect,
      });

      const memberships = await prisma.chatMember.findMany({
        where: { userId: session.user.id },
        select: { chatId: true },
      });
      const chatIds = memberships.map((membership) => membership.chatId);

      if (chatIds.length > 0) {
        const relatedMembers = await prisma.chatMember.findMany({
          where: { chatId: { in: chatIds } },
          select: { userId: true },
        });
        const relatedUserIds = [...new Set(relatedMembers.map((member) => member.userId))];

        for (const chatId of chatIds) {
          io.to(`chat:${chatId}`).emit('user:updated', { user: publicUser(user) });
        }

        for (const userId of relatedUserIds) {
          io.to(`user:${userId}`).emit('user:updated', { user: publicUser(user) });
          io.to(`user:${userId}`).emit('chat:list:invalidate');
        }
      } else {
        io.to(`user:${session.user.id}`).emit('user:updated', { user: publicUser(user) });
      }

      return { user: publicUser(user) };
    },
  );
}
