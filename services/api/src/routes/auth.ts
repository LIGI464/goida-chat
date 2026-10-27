import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { Server as SocketServer } from 'socket.io';

import { auth } from '../auth.js';
import { getAuthorizationPrincipal } from '../lib/principal.js';

export async function registerAuthRoutes(app: FastifyInstance, io: SocketServer) {
  app.get('/auth/me', async (request, reply) => {
    const principal = await getAuthorizationPrincipal(request.headers);

    if (!principal) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    if (principal.kind === 'guest') {
      return {
        kind: principal.kind,
        user: principal.user,
        session: principal.session,
        chatId: principal.chatId,
        inviteToken: principal.inviteToken,
      };
    }
    const session = principal;

    const user = session.user as typeof session.user & {
      username?: string | null;
      displayUsername?: string | null;
    };

    return {
      kind: 'user',
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
        const forwardedProto = request.headers['x-forwarded-proto'];
        const protocol = Array.isArray(forwardedProto)
          ? forwardedProto[0]
          : (forwardedProto?.split(',')[0]?.trim() ?? 'http');
        const url = new URL(request.url, `${protocol}://${request.headers.host ?? 'localhost'}`);
        const headers = fromNodeHeaders(request.headers);
        const signingOut =
          url.pathname === '/auth/sign-out'
            ? await getAuthorizationPrincipal(request.headers)
            : null;
        const authRequest = new Request(url, {
          method: request.method,
          headers,
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        });

        const response = await auth.handler(authRequest);
        if (response.ok && signingOut?.kind === 'user') {
          const sockets = await io.in(`user:${signingOut.id}`).fetchSockets();
          for (const socket of sockets) {
            if (socket.data.principal?.session.id === signingOut.session.id)
              socket.disconnect(true);
          }
        }

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
