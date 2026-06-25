import type { FastifyInstance } from 'fastify';
import { updateProfileSchema, usernameSchema } from '@goida-chat/shared';

import { badRequest } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { requireSession, publicUser } from '../lib/session.js';
import { publicUserSelect } from '../services/chat.js';

export async function registerUserRoutes(app: FastifyInstance) {
  app.get(
    '/users/search',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const session = await requireSession(request);
      const parsed = usernameSchema.safeParse(
        (request.query as { username?: string }).username ?? '',
      );

      if (!parsed.success) {
        return { users: [] };
      }

      const users = await prisma.user.findMany({
        where: {
          id: { not: session.user.id },
          username: { contains: parsed.data, mode: 'insensitive' },
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

      return { user: publicUser(user) };
    },
  );
}
