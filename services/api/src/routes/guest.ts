import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import { z } from 'zod';

import { env } from '../config.js';
import { GUEST_COOKIE_NAME, GUEST_SESSION_TTL_MS } from '../lib/guest-cookie.js';
import { forbidden, notFound } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { getAuthorizationPrincipal, guestCookies, toGuestPrincipal } from '../lib/principal.js';
import { consumeGuestRateLimit } from '../services/guest-rate-limit.js';
import { removeExpiredGuestVoice } from '../services/guest-voice.js';

export async function registerGuestRoutes(app: FastifyInstance, io: SocketServer) {
  app.post('/auth/guest/start', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== new URL(env.APP_URL).origin) {
      throw forbidden('Forbidden origin');
    }
    const { token } = z.object({ token: z.string().min(16).max(256) }).parse(request.body);
    const principal = await getAuthorizationPrincipal(request.headers);
    if (principal?.kind === 'user') throw forbidden('Already signed in; use the invite join endpoint');

    const ipHash = createHmac('sha256', env.COOKIE_SECRET).update(request.ip).digest('hex');
    await consumeGuestRateLimit(`start:${ipHash}`, 20, 60 * 60_000);
    const invite = await prisma.chatInvite.findUnique({ where: { token }, include: { chat: true } });
    if (!invite || invite.chat.type !== 'group' || (invite.expiresAt && invite.expiresAt <= new Date())) {
      throw notFound('Invite not found or expired');
    }
    if (principal?.kind === 'guest' && principal.chatId === invite.chatId && principal.inviteToken === token) {
      return { ...principal, chatId: principal.chatId };
    }
    await consumeGuestRateLimit(`create:${ipHash}`, 5, 60 * 60_000);
    const expiresAt = new Date(Math.min(
      Date.now() + GUEST_SESSION_TTL_MS,
      invite.expiresAt?.getTime() ?? Infinity,
    ));
    const guest = await prisma.$transaction(async (tx) => {
      if (principal?.kind === 'guest') {
        await tx.guestSession.updateMany({ where: { id: principal.session.id }, data: { expiresAt: new Date() } });
      }
      return tx.guestSession.create({ data: {
        guestId: `guest_${randomUUID()}`,
        displayName: `Гость ${randomUUID().slice(0, 8)}`,
        inviteToken: token,
        chatId: invite.chatId,
        expiresAt,
      } });
    });
    if (principal?.kind === 'guest') {
      io.in(`user:${principal.id}`).disconnectSockets(true);
      await removeExpiredGuestVoice(principal).catch((error) => request.log.warn({ error }, 'guest voice cleanup will retry'));
    }
    io.to(`chat:${invite.chatId}`).emit('chat:list:invalidate');
    reply.setCookie(GUEST_COOKIE_NAME, guestCookies.sign(guest.id), {
      httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
      expires: expiresAt, maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
    });
    return toGuestPrincipal(guest);
  });

  app.post('/auth/guest/sign-out', async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== new URL(env.APP_URL).origin) {
      throw forbidden('Forbidden origin');
    }
    const id = guestCookies.read(request.headers.cookie);
    if (id) {
      const guest = await prisma.guestSession.findUnique({ where: { id } });
      await prisma.guestSession.updateMany({ where: { id }, data: { expiresAt: new Date() } });
      if (guest) {
        io.in(`user:${guest.guestId}`).disconnectSockets(true);
        await removeExpiredGuestVoice(toGuestPrincipal(guest)).catch((error) => request.log.warn({ error }, 'guest voice cleanup will retry'));
      }
    }
    reply.clearCookie(GUEST_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });
}
