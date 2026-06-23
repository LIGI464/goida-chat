import type { FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';

import { auth } from '../auth.js';
import { unauthorized } from './http.js';

export async function requireSession(request: FastifyRequest) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });

  if (!session) {
    throw unauthorized();
  }

  return session;
}

export type AuthSession = Awaited<ReturnType<typeof requireSession>>;
export type AuthUser = AuthSession['user'] & {
  username?: string | null;
  displayUsername?: string | null;
};

export function publicUser(user: {
  id: string;
  name: string;
  username?: string | null;
  displayUsername?: string | null;
  image?: string | null;
}) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    displayUsername: user.displayUsername,
    image: user.image,
  };
}
