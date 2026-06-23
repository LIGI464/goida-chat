import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { ZodError } from 'zod';

import { env } from './config.js';
import { HttpError } from './lib/http.js';
import { prisma } from './lib/prisma.js';
import { valkey } from './lib/valkey.js';
import { registerRealtime } from './realtime.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerChatRoutes } from './routes/chats.js';
import { registerUserRoutes } from './routes/users.js';
import { registerVoiceRoutes } from './routes/voice.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: env.APP_URL,
    credentials: true,
  });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: error.issues[0]?.message ?? 'Invalid request',
      });
    }

    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }

    const normalizedError = error instanceof Error ? error : new Error('Unknown error');
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode >= 500) request.log.error({ error }, 'request failed');
    return reply
      .code(statusCode)
      .send({ error: statusCode >= 500 ? 'Internal server error' : normalizedError.message });
  });

  const io = new SocketServer(app.server, {
    cors: { origin: env.APP_URL, credentials: true },
  });

  app.get('/health', async () => ({ status: 'ok', service: 'api' }));
  await registerAuthRoutes(app);
  await registerUserRoutes(app);
  await registerChatRoutes(app, io);
  await registerVoiceRoutes(app);
  registerRealtime(io, app.log);

  app.addHook('onClose', async () => {
    io.close();
    valkey.disconnect();
    await prisma.$disconnect();
  });

  return app;
}
