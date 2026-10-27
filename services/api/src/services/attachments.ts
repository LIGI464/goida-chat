import { randomUUID } from 'node:crypto';
import type { Attachment, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ATTACHMENT_TTL_MS } from '@goida-chat/shared';
import { badRequest, notFound } from '../lib/http.js';
import { messageSelect, serializeMessage } from './chat.js';
import type { StorageAdapter } from '../storage/adapter.js';
import type { AuthorizationPrincipal } from '../lib/principal.js';

export const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
export type StoredAttachment = Attachment & { message: { chatId: string } | null };

export function attachmentRepository(db: PrismaClient, storage: StorageAdapter) {
  return {
    begin(metadata: { originalName: string; mimeType: string }) {
      return db.attachment.create({
        data: {
          ...metadata,
          storageKey: randomUUID(),
          expiresAt: new Date(Date.now() + ATTACHMENT_TTL_MS),
        },
      });
    },
    async complete(
      attachment: Attachment,
      chatId: string,
      userId: string,
      text: string,
      size: number,
      actor?: AuthorizationPrincipal,
    ) {
      const message = await db.$transaction(async (tx) => {
        const guest = actor?.kind === 'guest' ? actor : null;
        if (guest) {
          // Lock the session with a conditional write so expiry/sign-out racing
          // a slow upload cannot publish using a stale principal.
          const active = await tx.guestSession.updateMany({
            where: { id: guest.session.id, chatId, expiresAt: { gt: new Date() } },
            data: { expiresAt: guest.session.expiresAt },
          });
          if (active.count !== 1) throw notFound('Chat not found');
        } else {
          const member = await tx.chatMember.findUnique({
            where: { chatId_userId: { chatId, userId } },
          });
          if (!member) throw notFound('Chat not found');
        }
        const created = await tx.message.create({
          data: {
            chatId,
            text,
            ...(guest ? { guestSessionId: guest.session.id } : { userId }),
          },
        });
        const attached = await tx.attachment.updateMany({
          where: {
            id: attachment.id,
            status: 'uploading',
            storageDeletedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { messageId: created.id, size, status: 'active' },
        });
        if (attached.count !== 1) throw badRequest('Время загрузки истекло. Повтори отправку');
        // This write also ensures a concurrently removed membership cannot
        // publish a message successfully after leaving the chat.
        if (!guest)
          await tx.chatMember.update({
            where: { chatId_userId: { chatId, userId } },
            data: { lastReadMessageId: created.id },
          });
        await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
        return tx.message.findUniqueOrThrow({ where: { id: created.id }, select: messageSelect });
      });
      return serializeMessage(message);
    },
    get(id: string): Promise<StoredAttachment | null> {
      return db.attachment.findUnique({
        where: { id },
        include: { message: { select: { chatId: true } } },
      });
    },
    async abandon(attachment: Attachment) {
      const abandoned = await db.attachment.updateMany({
        where: { id: attachment.id, status: 'uploading' },
        data: { status: 'expired' },
      });
      // A lost transaction response may hide a successful commit. Never delete
      // an object that has already become active (or another cleaner owns).
      if (abandoned.count !== 1) return;
      await storage.remove(attachment.storageKey);
      await db.attachment.update({
        where: { id: attachment.id },
        data: { storageDeletedAt: new Date() },
      });
    },
  };
}

export type AttachmentRepository = ReturnType<typeof attachmentRepository>;

export async function cleanupExpiredAttachments(
  db: PrismaClient,
  storage: StorageAdapter,
  log: Pick<FastifyBaseLogger, 'error'>,
  now = new Date(),
) {
  await db.attachment.updateMany({
    where: {
      status: { not: 'expired' },
      OR: [
        { expiresAt: { lte: now } },
        { status: 'active', messageId: null },
        {
          status: 'uploading',
          createdAt: { lte: new Date(now.getTime() - UPLOAD_TIMEOUT_MS * 2) },
        },
      ],
    },
    data: { status: 'expired' },
  });
  // Bounded batches, with a cursor so one broken storage object cannot starve
  // later objects. Failures remain eligible for the next scheduled attempt.
  let cursor: string | undefined;
  let removed = 0;
  for (;;) {
    const expired = await db.attachment.findMany({
      where: { status: 'expired', storageDeletedAt: null },
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const attachment of expired) {
      try {
        await storage.remove(attachment.storageKey);
        await db.attachment.update({
          where: { id: attachment.id },
          data: { storageDeletedAt: now },
        });
        removed++;
      } catch (error) {
        log.error({ error, attachmentId: attachment.id }, 'attachment cleanup failed; will retry');
      }
    }
    if (expired.length < 100) return removed;
    cursor = expired[expired.length - 1]!.id;
  }
}
