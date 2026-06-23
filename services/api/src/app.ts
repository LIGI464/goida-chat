import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { Server as SocketServer } from 'socket.io';

import { env } from './config.js';
import { prisma } from './lib/prisma.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: env.APP_URL,
    credentials: true,
  });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  app.get('/health', async () => ({ status: 'ok', service: 'api' }));

  const io = new SocketServer(app.server, {
    cors: { origin: env.APP_URL, credentials: true },
  });

  io.on('connection', (socket) => {
    app.log.debug({ socketId: socket.id }, 'socket connected');
  });

  app.addHook('onClose', async () => {
    io.close();
    await prisma.$disconnect();
  });

  return app;
}
