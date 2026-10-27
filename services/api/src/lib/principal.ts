import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { GuestSession } from '@prisma/client';

import { auth } from '../auth.js';
import { env } from '../config.js';
import { prisma } from './prisma.js';
import { forbidden, notFound, unauthorized } from './http.js';
import { guestCookieSigner } from './guest-cookie.js';

export const guestCookies = guestCookieSigner(env.COOKIE_SECRET);
type UserSession = typeof auth.$Infer.Session;
export type UserPrincipal = {
  kind: 'user';
  id: string;
  user: UserSession['user'];
  session: UserSession['session'];
};
export type GuestPrincipal = {
  kind: 'guest';
  id: string;
  user: { id: string; name: string; email: null; username: null; image: null };
  session: { id: string; expiresAt: Date };
  chatId: string;
  inviteToken: string;
};
export type AuthorizationPrincipal = UserPrincipal | GuestPrincipal;

export function toGuestPrincipal(guest: GuestSession): GuestPrincipal {
  return {
    kind: 'guest',
    id: guest.guestId,
    user: { id: guest.guestId, name: guest.displayName, email: null, username: null, image: null },
    session: { id: guest.id, expiresAt: guest.expiresAt },
    chatId: guest.chatId,
    inviteToken: guest.inviteToken,
  };
}

export async function getAuthorizationPrincipal(headers: IncomingHttpHeaders): Promise<AuthorizationPrincipal | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (session) return { kind: 'user', id: session.user.id, ...session };
  const id = guestCookies.read(headers.cookie);
  if (!id) return null;
  const guest = await prisma.guestSession.findUnique({ where: { id } });
  return guest && guest.expiresAt > new Date() ? toGuestPrincipal(guest) : null;
}

export async function requirePrincipal(request: FastifyRequest) {
  const principal = await getAuthorizationPrincipal(request.headers);
  if (!principal) throw unauthorized();
  return principal;
}

export async function assertActiveGuest(principal: GuestPrincipal) {
  if (principal.session.expiresAt <= new Date()) throw unauthorized('Guest session expired');
  const guest = await prisma.guestSession.findFirst({
    where: { id: principal.session.id, chatId: principal.chatId, expiresAt: { gt: new Date() } },
  });
  if (!guest) throw unauthorized('Guest session expired');
}

export function assertGuestScope(principal: GuestPrincipal, chatId: string) {
  if (principal.session.expiresAt <= new Date()) throw unauthorized('Guest session expired');
  if (principal.chatId !== chatId) throw notFound('Chat not found');
}

export async function ensurePrincipalChatAccess(principal: AuthorizationPrincipal, chatId: string) {
  if (principal.kind === 'guest') {
    assertGuestScope(principal, chatId);
    await assertActiveGuest(principal);
    return;
  }
  const member = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: principal.id } },
  });
  if (!member) throw notFound('Chat not found');
}

export function requireUserPrincipal(principal: AuthorizationPrincipal): UserPrincipal {
  if (principal.kind !== 'user') throw forbidden('This action requires an account');
  return principal;
}
