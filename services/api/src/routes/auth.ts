import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';

import { auth } from '../auth.js';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/auth/me', async (request, reply) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const user = session.user as typeof session.user & {
      username?: string | null;
      displayUsername?: string | null;
    };

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        displayUsername: user.displayUsername,
      },
      session: {
        id: session.session.id,
        expiresAt: session.session.expiresAt,
      },
    };
  });

  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    async handler(request, reply) {
      try {
        const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
        const headers = fromNodeHeaders(request.headers);
        const authRequest = new Request(url, {
          method: request.method,
          headers,
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        });

        const response = await auth.handler(authRequest);

        reply.code(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));

        return reply.send(response.body ? await response.text() : null);
      } catch (error) {
        request.log.error({ error }, 'authentication request failed');
        return reply.code(500).send({
          error: 'Internal authentication error',
          code: 'AUTH_FAILURE',
        });
      }
    },
  });
}
