import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNED_URL_TTL_MS = 5 * 60 * 1000;
export type AttachmentLinkMode = 'preview' | 'download';

export function createAttachmentSigner(secret: string) {
  if (secret.length < 32)
    throw new Error('Attachment signing secret must have at least 32 characters');
  function signature(id: string, userId: string, expires: number, mode: AttachmentLinkMode) {
    return createHmac('sha256', secret)
      .update(`attachment-v1\n${id}\n${userId}\n${expires}\n${mode}`)
      .digest();
  }
  return {
    sign(
      chatId: string,
      id: string,
      userId: string,
      expiresAt: Date,
      mode: AttachmentLinkMode,
      now = Date.now(),
    ) {
      const expires = Math.floor(Math.min(now + SIGNED_URL_TTL_MS, expiresAt.getTime()) / 1000);
      const token = signature(id, userId, expires, mode).toString('base64url');
      return {
        url: `/chats/${chatId}/attachments/${id}/content?expires=${expires}&mode=${mode}&token=${token}`,
        expiresAt: new Date(expires * 1000).toISOString(),
      };
    },
    verify(
      id: string,
      userId: string,
      expires: number,
      mode: AttachmentLinkMode,
      token: string,
      now = Date.now(),
    ) {
      if (
        !Number.isSafeInteger(expires) ||
        expires * 1000 <= now ||
        expires * 1000 > now + SIGNED_URL_TTL_MS ||
        !/^[A-Za-z0-9_-]{43}$/.test(token)
      )
        return false;
      const actual = Buffer.from(token, 'base64url');
      const expected = signature(id, userId, expires, mode);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    },
  };
}
