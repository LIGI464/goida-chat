import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import type { Attachment, PrismaClient } from '@prisma/client';
import type { AttachmentRouteDependencies } from '../src/routes/attachments.js';
import type { StoredAttachment } from '../src/services/attachments.js';

// No production DB, Redis or credentials are used by these HTTP/storage tests.
Object.assign(process.env, {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://test:test@localhost:1/test',
  COOKIE_SECRET: 'attachment-test-secret-not-for-production',
  BETTER_AUTH_SECRET: 'attachment-test-secret-not-for-production',
  LIVEKIT_API_KEY: 'test',
  LIVEKIT_API_SECRET: 'test',
});
const { attachmentRoutes } = await import('../src/routes/attachments.js');
const { cleanupExpiredAttachments } = await import('../src/services/attachments.js');
const { FilesystemStorageAdapter } = await import('../src/storage/adapter.js');
const { createAttachmentSigner } = await import('../src/storage/signed.js');
const { validateFileMetadata } = await import('../src/storage/validation.js');
const { HttpError } = await import('../src/lib/http.js');
const { MAX_ATTACHMENT_BYTES, ATTACHMENT_TTL_MS, ATTACHMENT_EXPIRED_MESSAGE } =
  await import('@goida-chat/shared');

const chatId = 'caaaaaaaaaaaaaaaaaaaaaaaa';
const otherChat = 'cbbbbbbbbbbbbbbbbbbbbbbbb';
const root = await mkdtemp(join(tmpdir(), 'goida-attachment-test-'));
const storage = new FilesystemStorageAdapter(root);
const signer = createAttachmentSigner('attachment-test-secret-not-for-production');
const rows = new Map<string, StoredAttachment>();
let sequence = 0;
let member = true;
let quota = 0;
let failPublish = false;
let rejectCommit = false;
let published = 0;
const app = Fastify({ bodyLimit: 64 * 1024 });
app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) =>
  reply.code(error.statusCode ?? 500).send({ error: error.message }),
);
const dependencies: AttachmentRouteDependencies = {
  storage,
  signer,
  authenticate: async (req) => {
    if (!req.headers['x-user']) throw new HttpError(401, 'Unauthorized');
    return String(req.headers['x-user']);
  },
  ensureMember: async (_id, chat) => {
    if (!member || chat !== chatId) throw new HttpError(404, 'Chat not found');
  },
  consumeQuota: async () => {
    if (++quota > 10) throw new HttpError(429, 'Rate limit');
  },
  publish: async () => {
    if (failPublish) throw new Error('Socket unavailable');
    published++;
  },
  repository: {
    begin: async (metadata) => {
      const row: StoredAttachment = {
        ...metadata,
        id: `c${String(++sequence).padStart(24, '0')}`,
        storageKey: randomUUID(),
        messageId: null,
        message: null,
        status: 'uploading',
        size: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + ATTACHMENT_TTL_MS),
        storageDeletedAt: null,
      };
      rows.set(row.id, row);
      return row;
    },
    complete: async (attachment, chat, userId, text, size) => {
      if (rejectCommit) throw new HttpError(404, 'Chat not found');
      const row = rows.get(attachment.id)!;
      Object.assign(row, {
        messageId: `message${sequence}`,
        message: { chatId: chat },
        status: 'active',
        size,
      });
      return {
        id: row.messageId!,
        chatId: chat,
        userId,
        text,
        createdAt: new Date(),
        editedAt: null,
        user: {
          id: userId,
          name: 'Tester',
          username: 'tester',
          displayUsername: null,
          image: null,
        },
        attachments: [
          {
            id: row.id,
            originalName: row.originalName,
            mimeType: row.mimeType,
            size,
            status: row.status,
            expiresAt: row.expiresAt,
          },
        ],
      };
    },
    get: async (id) => rows.get(id) ?? null,
    abandon: async (attachment) => {
      attachment.status = 'expired';
      await storage.remove(attachment.storageKey);
      attachment.storageDeletedAt = new Date();
    },
  },
};
await app.register(attachmentRoutes, dependencies);
app.post('/json', async (req) => req.body);
let address: string;
before(async () => {
  address = await app.listen({ host: '127.0.0.1', port: 0 });
});
after(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

function multipart(
  name = 'note.txt',
  mime = 'text/plain',
  data = Buffer.from('hello'),
  suffix = '',
  closed = true,
) {
  return Buffer.concat([
    Buffer.from(
      `--boundary\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n${suffix}${closed ? '--boundary--\r\n' : ''}`),
  ]);
}
async function upload(payload: Buffer, headers: Record<string, string> = {}) {
  quota = 0;
  return app.inject({
    method: 'POST',
    url: `/chats/${chatId}/attachments`,
    headers: {
      'x-user': 'member',
      'content-type': 'multipart/form-data; boundary=boundary',
      ...headers,
    },
    payload,
  });
}
async function validUpload() {
  const response = await upload(multipart());
  assert.equal(response.statusCode, 201, response.body);
  return rows.get(response.json().message.attachments[0].id)!;
}

test('multiple uploads create distinct IDs, captions, metadata and stored bytes', async () => {
  const first = await validUpload();
  const second = await validUpload();
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.storageKey, second.storageKey);
  assert.equal(first.size, 5);
  assert.equal(first.expiresAt.getTime() - first.createdAt.getTime(), ATTACHMENT_TTL_MS);
  assert.equal((await stat(join(root, first.storageKey))).size, 5);
  const response = await upload(
    multipart(
      'note.txt',
      'text/plain',
      Buffer.from('hi'),
      '--boundary\r\nContent-Disposition: form-data; name="text"\r\n\r\ncaption\r\n',
    ),
  );
  assert.equal(response.json().message.text, 'caption');
  assert.ok(published >= 3);
});

test('rejects executable names, double extensions, header spoofing and mismatched MIME', async () => {
  const cases: [string, string, Buffer][] = [
    ['virus.exe', 'text/plain', Buffer.from('hello')],
    ['virus.exe.txt', 'text/plain', Buffer.from('hello')],
    ['virus.txt', 'text/plain', Buffer.from('MZpayload')],
    ['virus.pdf', 'application/pdf', Buffer.from('MZpayload')],
    ['fake.png', 'image/png', Buffer.from('hello')],
    ['photo.png', 'application/pdf', Buffer.from('%PDF-')],
    ['link.svg', 'image/svg+xml', Buffer.from('<svg/>')],
    ['binary.txt', 'text/plain', Buffer.from([0, 255, 0])],
    ['empty.txt', 'text/plain', Buffer.alloc(0)],
    ['script.txt', 'text/plain', Buffer.from('#!/bin/sh')],
    ['archive.zip', 'application/zip', Buffer.from('PK')],
  ];
  const before = await readdir(root);
  for (const [name, mime, data] of cases) {
    const response = await upload(multipart(name, mime, data));
    assert.equal(response.statusCode, 400, `${name}: ${response.body}`);
  }
  assert.deepEqual(await readdir(root), before);
  assert.throws(() => validateFileMetadata('../secret.txt', 'text/plain'));
  assert.throws(() => validateFileMetadata('file:secret.txt', 'text/plain'));
});

test(
  'malformed, extra-file and oversized text parts cannot leave orphan files',
  { timeout: 15_000 },
  async () => {
    const before = await readdir(root);
    const secondFile =
      '--boundary\r\nContent-Disposition: form-data; name="file"; filename="two.txt"\r\nContent-Type: text/plain\r\n\r\nsecond\r\n';
    for (const payload of [
      multipart('one.txt', 'text/plain', Buffer.from('first'), secondFile),
      multipart('note.txt', 'text/plain', Buffer.from('hi'), '', false),
      multipart(
        'note.txt',
        'text/plain',
        Buffer.from('hi'),
        `--boundary\r\nContent-Disposition: form-data; name="text"\r\n\r\n${'x'.repeat(17_000)}\r\n`,
      ),
    ]) {
      const response = await upload(payload);
      assert.ok(response.statusCode >= 400 && response.statusCode < 500, response.body);
    }
    assert.deepEqual(await readdir(root), before);
  },
);

test('authentication, membership, origin and quota reject before storage writes', async () => {
  const before = rows.size;
  assert.equal((await upload(multipart(), { 'x-user': '' })).statusCode, 401);
  member = false;
  assert.equal((await upload(multipart())).statusCode, 404);
  member = true;
  assert.equal((await upload(multipart(), { origin: 'https://evil.example' })).statusCode, 403);
  assert.equal((await upload(multipart(), { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
  quota = 10;
  const limited = await app.inject({
    method: 'POST',
    url: `/chats/${chatId}/attachments`,
    headers: { 'x-user': 'member', 'content-type': 'multipart/form-data; boundary=boundary' },
    payload: multipart(),
  });
  assert.equal(limited.statusCode, 429);
  assert.equal(rows.size, before);
});

test('revoked membership at commit cleans upload; notification failure preserves committed file', async () => {
  const before = await readdir(root);
  rejectCommit = true;
  assert.equal((await upload(multipart())).statusCode, 404);
  rejectCommit = false;
  assert.deepEqual(await readdir(root), before);
  failPublish = true;
  const row = await validUpload();
  failPublish = false;
  assert.equal((await stat(join(root, row.storageKey))).size, 5);
  assert.equal(row.status, 'active');
});

test('signed content requires current membership and binds user, mode, ID and deadline', async () => {
  const row = await validUpload();
  const signed = await app.inject({
    url: `/chats/${chatId}/attachments/${row.id}/url`,
    headers: { 'x-user': 'member' },
  });
  assert.equal(signed.statusCode, 200);
  const { url } = signed.json();
  const content = await app.inject({ url, headers: { 'x-user': 'member' } });
  assert.equal(content.statusCode, 200);
  assert.equal(content.body, 'hello');
  assert.equal(content.headers['cache-control'], 'private, no-store');
  assert.match(String(content.headers['content-disposition']), /^attachment;/);
  assert.equal((await app.inject({ url })).statusCode, 401);
  assert.equal((await app.inject({ url, headers: { 'x-user': 'other' } })).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        url: url.replace('mode=download', 'mode=preview'),
        headers: { 'x-user': 'member' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: url.replace(chatId, otherChat), headers: { 'x-user': 'member' } }))
      .statusCode,
    404,
  );
  member = false;
  assert.equal((await app.inject({ url, headers: { 'x-user': 'member' } })).statusCode, 404);
  member = true;
  const params = new URL(url, 'http://localhost').searchParams;
  assert.equal(
    signer.verify(
      row.id,
      'member',
      Number(params.get('expires')),
      'download',
      params.get('token')!,
      Date.now() + 301_000,
    ),
    false,
  );
  row.expiresAt = new Date(Date.now() - 1);
  const expired = await app.inject({ url, headers: { 'x-user': 'member' } });
  assert.equal(expired.statusCode, 410);
  assert.equal(expired.json().error, ATTACHMENT_EXPIRED_MESSAGE);
});

test('raster preview is inline; download disposition and MIME stay correct', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=',
    'base64',
  );
  const uploaded = await upload(multipart('pixel.png', 'image/png', png));
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const id = uploaded.json().message.attachments[0].id;
  const signed = await app.inject({
    url: `/chats/${chatId}/attachments/${id}/url?mode=preview`,
    headers: { 'x-user': 'member' },
  });
  const response = await app.inject({ url: signed.json().url, headers: { 'x-user': 'member' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.match(String(response.headers['content-disposition']), /^inline;/);
  assert.deepEqual(response.rawPayload, png);
});

test('actual streamed HTTP upload accepts exactly 100 MiB and rejects the next byte; JSON stays at 64 KiB', async () => {
  async function streamUpload(size: number) {
    quota = 0;
    const req = httpRequest(`${address}/chats/${chatId}/attachments`, {
      method: 'POST',
      headers: { 'x-user': 'member', 'content-type': 'multipart/form-data; boundary=boundary' },
    });
    const result = new Promise<{ status: number; body: string }>((resolve, reject) => {
      req.on('response', async (res) => {
        let body = '';
        for await (const chunk of res) body += chunk;
        resolve({ status: res.statusCode!, body });
      });
      req.on('error', reject);
    });
    req.write(
      '--boundary\r\nContent-Disposition: form-data; name="file"; filename="large.txt"\r\nContent-Type: text/plain\r\n\r\n',
    );
    const chunk = Buffer.alloc(64 * 1024, 'a');
    for (let remaining = size; remaining > 0; remaining -= chunk.length) {
      if (!req.write(chunk.subarray(0, Math.min(remaining, chunk.length))))
        await once(req, 'drain');
    }
    req.end('\r\n--boundary--\r\n');
    return result;
  }
  const accepted = await streamUpload(MAX_ATTACHMENT_BYTES);
  assert.equal(accepted.status, 201, accepted.body);
  assert.equal(JSON.parse(accepted.body).message.attachments[0].size, MAX_ATTACHMENT_BYTES);
  const before = await readdir(root);
  const rejected = await streamUpload(MAX_ATTACHMENT_BYTES + 1);
  assert.equal(rejected.status, 413, rejected.body);
  assert.deepEqual(await readdir(root), before);
  const json = await app.inject({
    method: 'POST',
    url: '/json',
    payload: { text: 'a'.repeat(65536) },
  });
  assert.equal(json.statusCode, 413);
});

test('storage rejects path traversal and reports deletion errors for cleanup retry', async () => {
  await assert.rejects(
    storage.put('../outside', Readable.from('x'), 'text/plain'),
    /Invalid storage key/,
  );
  const directoryKey = randomUUID();
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, directoryKey));
  await assert.rejects(storage.remove(directoryKey));
});

test('a disconnected client cannot publish a partial attachment', async () => {
  quota = 0;
  const before = rows.size;
  const req = httpRequest(`${address}/chats/${chatId}/attachments`, {
    method: 'POST',
    headers: { 'x-user': 'member', 'content-type': 'multipart/form-data; boundary=boundary' },
  });
  req.on('error', () => undefined); // client cancellation is intentional
  req.write(
    '--boundary\r\nContent-Disposition: form-data; name="file"; filename="partial.txt"\r\nContent-Type: text/plain\r\n\r\n',
  );
  req.write(Buffer.alloc(64 * 1024, 'a'));
  for (let attempt = 0; rows.size === before && attempt < 100; attempt++) await delay(10);
  req.destroy();
  assert.equal(rows.size, before + 1);
  const pending = [...rows.values()].at(-1)!;
  for (let attempt = 0; !pending.storageDeletedAt && attempt < 100; attempt++) await delay(10);
  assert.equal(pending.status, 'expired');
  assert.equal(pending.messageId, null);
  assert.ok(pending.storageDeletedAt);
  await assert.rejects(stat(join(root, pending.storageKey)), { code: 'ENOENT' });
});

test('cleanup marks due/orphan/abandoned objects and retries a failed deletion', async () => {
  const base = [...rows.values()][0]!;
  const due: Attachment = {
    ...base,
    id: 'expired',
    status: 'active',
    expiresAt: new Date(0),
    storageDeletedAt: null,
  };
  const abandoned: Attachment = {
    ...base,
    id: 'pending',
    status: 'uploading',
    createdAt: new Date(0),
    storageDeletedAt: null,
  };
  const orphan: Attachment = {
    ...base,
    id: 'orphan',
    status: 'active',
    messageId: null,
    storageDeletedAt: null,
  };
  const active: Attachment = {
    ...base,
    id: 'live',
    expiresAt: new Date(Date.now() + ATTACHMENT_TTL_MS),
    storageDeletedAt: null,
  };
  const records = [due, abandoned, orphan, active];
  let predicate: unknown;
  const fakeDb = {
    attachment: {
      updateMany: async (input: unknown) => {
        predicate = input;
        for (const row of [due, abandoned, orphan]) row.status = 'expired';
      },
      findMany: async () =>
        records.filter((row) => row.status === 'expired' && !row.storageDeletedAt),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Attachment> }) =>
        Object.assign(records.find((row) => row.id === where.id)!, data),
    },
  } as unknown as PrismaClient;
  let failOnce = true;
  let failures = 0;
  const fakeStorage = {
    ...storage,
    put: storage.put.bind(storage),
    read: storage.read.bind(storage),
    remove: async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('Disk temporarily unavailable');
      }
    },
  };
  const logger = {
    error: () => {
      failures++;
    },
  };
  assert.equal(await cleanupExpiredAttachments(fakeDb, fakeStorage, logger), 2);
  assert.equal(due.storageDeletedAt, null);
  assert.equal(due.status, 'expired');
  assert.equal(failures, 1);
  assert.equal(await cleanupExpiredAttachments(fakeDb, fakeStorage, logger), 1);
  assert.ok(due.storageDeletedAt);
  assert.equal(active.status, 'active');
  assert.equal(active.storageDeletedAt, null);
  assert.match(JSON.stringify(predicate), /messageId/);
});
