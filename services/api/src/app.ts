import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
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

const appOrigin = new URL(env.APP_URL).origin;
const devOrigins = new Set(['localhost', '127.0.0.1']);

function isAllowedOrigin(origin?: string | null) {
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    if (parsed.origin === appOrigin) return true;
    return env.NODE_ENV !== 'production' && devOrigins.has(parsed.hostname);
  } catch {
    return false;
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: env.NODE_ENV === 'production',
    bodyLimit: 64 * 1024,
  });

  await app.register(cors, {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
  });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
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
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: true,
    },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback('Forbidden origin', false);
    },
  });

  app.get('/health', async () => ({ status: 'ok', service: 'api' }));
  await registerAuthRoutes(app);
  await registerUserRoutes(app, io);
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
