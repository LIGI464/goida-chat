import { Signer } from '@fastify/cookie';

export const GUEST_COOKIE_NAME = 'goida-guest-session';
export const GUEST_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export function guestCookieSigner(secret: string) {
  const signer = new Signer(secret);
  return {
    sign: (value: string) => signer.sign(value),
    read(header?: string) {
      const value = header?.split(';').map((item) => item.trim())
        .find((item) => item.startsWith(`${GUEST_COOKIE_NAME}=`))
        ?.slice(GUEST_COOKIE_NAME.length + 1);
      if (!value) return null;
      try {
        const result = signer.unsign(decodeURIComponent(value));
        return result.valid ? result.value : null;
      } catch {
        return null;
      }
    },
  };
}
