import type { FastifyInstance } from 'fastify';
import { usernameSchema } from '@goida-chat/shared';

import { prisma } from '../lib/prisma.js';
import { requireSession, publicUser } from '../lib/session.js';
import { publicUserSelect } from '../services/chat.js';

export async function registerUserRoutes(app: FastifyInstance) {
  app.get('/users/search', async (request) => {
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
  });
}
