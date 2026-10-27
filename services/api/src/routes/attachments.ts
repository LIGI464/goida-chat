import multipart from '@fastify/multipart';
import {
  chatIdParamsSchema,
  MAX_ATTACHMENT_BYTES,
  ATTACHMENT_EXPIRED_MESSAGE,
} from '@goida-chat/shared';
import type { Attachment } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import { z } from 'zod';
import { env } from '../config.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import {
  requirePrincipal,
  ensurePrincipalChatAccess,
  type AuthorizationPrincipal,
} from '../lib/principal.js';
import { valkey } from '../lib/valkey.js';
import {
  attachmentRepository,
  cleanupExpiredAttachments,
  UPLOAD_TIMEOUT_MS,
  type AttachmentRepository,
} from '../services/attachments.js';
import { FilesystemStorageAdapter, type StorageAdapter } from '../storage/adapter.js';
import { createAttachmentSigner } from '../storage/signed.js';
import { validateFileMetadata } from '../storage/validation.js';

const attachmentParams = chatIdParamsSchema.extend({ attachmentId: z.string().cuid() });
const linkMode = z.enum(['download', 'preview']).default('download');
const contentQuery = z.object({
  expires: z.coerce.number().int(),
  token: z.string().max(64),
  mode: linkMode,
});

export type AttachmentRouteDependencies = {
  authenticate(request: FastifyRequest): Promise<string>;
  ensureMember(userId: string, chatId: string, request: FastifyRequest): Promise<unknown>;
  actor?(request: FastifyRequest): AuthorizationPrincipal | undefined;
  consumeQuota(userId: string): Promise<void>;
  repository: AttachmentRepository;
  storage: StorageAdapter;
  signer: ReturnType<typeof createAttachmentSigner>;
  publish(message: Awaited<ReturnType<AttachmentRepository['complete']>>): Promise<void>;
};

// Export the scoped plugin for HTTP tests with a real multipart parser/storage.
export async function attachmentRoutes(app: FastifyInstance, deps: AttachmentRouteDependencies) {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_ATTACHMENT_BYTES + 1,
      files: 1,
      fields: 1,
      parts: 2,
      fieldSize: 16_000,
      fieldNameSize: 50,
      headerPairs: 20,
    },
  });
  const users = new WeakMap<FastifyRequest, string>();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store').header('Referrer-Policy', 'no-referrer');
    const userId = await deps.authenticate(request);
    const { chatId } = chatIdParamsSchema.parse(request.params);
    await deps.ensureMember(userId, chatId, request);
    users.set(request, userId);
  });

  app.post(
    '/chats/:chatId/attachments',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      onRequest: async (request) => {
        // Multipart is a CORS-simple request: explicitly reject cross-site writes.
        if (request.headers.origin) {
          let origin: string;
          try {
            origin = new URL(request.headers.origin).origin;
          } catch {
            throw forbidden('Forbidden origin');
          }
          if (origin !== new URL(env.APP_URL).origin) throw forbidden('Forbidden origin');
        } else if (request.headers['sec-fetch-site'] === 'cross-site')
          throw forbidden('Forbidden origin');
        await deps.consumeQuota(users.get(request)!);
      },
    },
    async (request, reply) => {
      const { chatId } = chatIdParamsSchema.parse(request.params);
      let pending: Attachment | undefined;
      let committed = false;
      let text = '';
      let size = 0;
      const abort = new AbortController();
      const onAbort = () => abort.abort();
      request.raw.once('aborted', onAbort);
      const timeout = setTimeout(() => {
        abort.abort();
        request.raw.destroy();
      }, UPLOAD_TIMEOUT_MS);
      timeout.unref();
      try {
        if (!request.isMultipart()) throw badRequest('Ожидается multipart/form-data');
        for await (const part of request.parts()) {
          if (part.type === 'field') {
            if (
              part.fieldname !== 'text' ||
              part.valueTruncated ||
              typeof part.value !== 'string' ||
              part.value.length > 4000
            )
              throw badRequest('Некорректный текст сообщения');
            text = part.value.trim();
            continue;
          }
          if (part.fieldname !== 'file' || pending) throw badRequest('Нужен один файл в поле file');
          // Busboy can emit a malformed-part error while the DB insert is pending.
          // Retain it in the stream state so pipeline cannot wait on a broken part.
          part.file.on('error', (error) => part.file.destroy(error));
          const metadata = validateFileMetadata(part.filename, part.mimetype);
          // Persist the key before writing bytes: a process crash or DB outage
          // cannot leave an object invisible to the cleanup job.
          pending = await deps.repository.begin(metadata);
          size = await deps.storage.put(
            pending.storageKey,
            part.file,
            pending.mimeType,
            abort.signal,
          );
          if (part.file.truncated)
            throw new HttpError(413, 'Размер файла не должен превышать 100 МБ');
        }
        if (!pending) throw badRequest('Файл не найден');
        if (abort.signal.aborted) throw badRequest('Загрузка прервана');
        const message = await deps.repository.complete(
          pending,
          chatId,
          users.get(request)!,
          text,
          size,
          deps.actor?.(request),
        );
        committed = true;
        // Notification failure must never delete a successfully committed file.
        await deps
          .publish(message)
          .catch((error) => request.log.error({ error }, 'attachment notification failed'));
        return reply.code(201).send({ message });
      } catch (error) {
        if (pending && !committed) {
          const failedUpload = pending;
          await deps.repository
            .abandon(failedUpload)
            .catch((cleanupError) =>
              request.log.error(
                { error: cleanupError, attachmentId: failedUpload.id },
                'upload cleanup deferred',
              ),
            );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        request.raw.off('aborted', onAbort);
      }
    },
  );

  async function accessible(request: FastifyRequest) {
    const { chatId, attachmentId } = attachmentParams.parse(request.params);
    const attachment = await deps.repository.get(attachmentId);
    if (!attachment || attachment.message?.chatId !== chatId || attachment.status === 'uploading')
      throw notFound('Вложение не найдено');
    if (attachment.status === 'expired' || attachment.expiresAt.getTime() <= Date.now())
      throw new HttpError(410, ATTACHMENT_EXPIRED_MESSAGE);
    return { attachment, chatId, userId: users.get(request)! };
  }

  app.get('/chats/:chatId/attachments/:attachmentId/url', async (request) => {
    const { attachment, chatId, userId } = await accessible(request);
    const { mode } = z.object({ mode: linkMode }).parse(request.query);
    if (mode === 'preview' && !attachment.mimeType.startsWith('image/'))
      throw badRequest('Предпросмотр доступен только для изображений');
    return deps.signer.sign(chatId, attachment.id, userId, attachment.expiresAt, mode);
  });

  app.get('/chats/:chatId/attachments/:attachmentId/content', async (request, reply) => {
    const { attachment, userId } = await accessible(request);
    const { expires, token, mode } = contentQuery.parse(request.query);
    if (!deps.signer.verify(attachment.id, userId, expires, mode, token))
      throw forbidden('Ссылка недействительна или истекла');
    if (mode === 'preview' && !attachment.mimeType.startsWith('image/')) throw forbidden();
    const source = await deps.storage.read(attachment.storageKey);
    reply
      .header('Content-Type', attachment.mimeType)
      .header('Content-Length', attachment.size)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'same-site')
      .header(
        'Content-Disposition',
        `${mode === 'preview' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.originalName).replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16))}`,
      );
    // Long downloads are cut off when the actual retention period ends.
    const expiryTimer = setTimeout(
      () => source.destroy(),
      Math.max(
        0,
        Math.min(
          attachment.expiresAt.getTime(),
          deps.actor?.(request)?.session.expiresAt.getTime() ?? Infinity,
        ) - Date.now(),
      ),
    );
    expiryTimer.unref();
    source.once('close', () => clearTimeout(expiryTimer));
    reply.raw.once('close', () => source.destroy());
    return reply.send(source);
  });
}

export async function registerAttachmentRoutes(app: FastifyInstance, io: SocketServer) {
  const storage = new FilesystemStorageAdapter(env.ATTACHMENTS_STORAGE_ROOT);
  const repository = attachmentRepository(prisma, storage);
  const principals = new WeakMap<FastifyRequest, AuthorizationPrincipal>();
  await app.register(attachmentRoutes, {
    storage,
    repository,
    signer: createAttachmentSigner(env.BETTER_AUTH_SECRET),
    authenticate: async (request: FastifyRequest) => {
      const principal = await requirePrincipal(request);
      principals.set(request, principal);
      return principal.id;
    },
    ensureMember: async (_id: string, chatId: string, request: FastifyRequest) => {
      await ensurePrincipalChatAccess(principals.get(request)!, chatId);
    },
    actor: (request: FastifyRequest) => principals.get(request),
    consumeQuota: async (userId) => {
      const count = await valkey.eval(
        "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 600) end; return n",
        1,
        `attachments:uploads:${userId}`,
      );
      if (Number(count) > 10) throw new HttpError(429, 'Не больше 10 файлов за 10 минут');
    },
    publish: async (message) => {
      io.to(`chat:${message.chatId}`).emit('message:new', message);
      const members = await prisma.chatMember.findMany({
        where: { chatId: message.chatId },
        select: { userId: true },
      });
      for (const { userId } of members) io.to(`user:${userId}`).emit('chat:list:invalidate');
    },
  });
  let running: Promise<unknown> | undefined;
  const run = () => {
    if (!running)
      running = cleanupExpiredAttachments(prisma, storage, app.log)
        .catch((error) => app.log.error({ error }, 'attachment cleanup job failed'))
        .finally(() => {
          running = undefined;
        });
    return running;
  };
  let timer: ReturnType<typeof setInterval>;
  app.addHook('onReady', async () => {
    void run();
    timer = setInterval(() => void run(), 60_000);
    timer.unref();
  });
  app.addHook('preClose', async () => {
    clearInterval(timer);
    await running;
  });
}
