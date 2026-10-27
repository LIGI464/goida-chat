/* global process, console, FormData, Blob, URL, AbortSignal, setTimeout, fetch */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const url = new URL(process.env.RELEASE_TEST_DATABASE_URL ?? '');
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.port !== '55433' ||
  !url.pathname.startsWith('/release_clean_')
) {
  throw new Error('Use a migrated isolated release_clean_ database on localhost:55433');
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: url.href,
  VALKEY_URL: 'redis://127.0.0.1:56380/1',
  APP_URL: 'http://localhost:5173',
  BETTER_AUTH_URL: 'http://localhost:3000',
  COOKIE_SECRET: 'release-test-cookie-secret-at-least-32-characters',
  BETTER_AUTH_SECRET: 'release-test-auth-secret-at-least-32-characters',
  LIVEKIT_API_KEY: 'release-test',
  LIVEKIT_API_SECRET: 'release-test-secret',
});
process.env.ATTACHMENTS_STORAGE_ROOT = await mkdtemp(resolve('../../.tmp/release-files-'));
const { prisma } = await import('../src/lib/prisma.ts');
const { valkey } = await import('../src/lib/valkey.ts');
const { buildApp } = await import('../src/app.ts');
const { cleanupExpiredAttachments } = await import('../src/services/attachments.ts');
const { FilesystemStorageAdapter } = await import('../src/storage/adapter.ts');
const app = await buildApp();
app.log.level = 'silent';
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const sockets = [];
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const actors = [];
let nextIp = 1;
const pass = (name) => console.log(`PASS ${name}`);
function actor() {
  return { cookie: '', ip: `127.1.0.${nextIp++}` };
}
async function request(who, method, path, payload) {
  const response = await app.inject({
    method,
    url: path,
    remoteAddress: who.ip,
    headers: {
      origin: process.env.APP_URL,
      host: 'localhost:3000',
      ...(who.cookie ? { cookie: who.cookie } : {}),
    },
    ...(payload === undefined ? {} : { payload }),
  });
  if (response.cookies.length) {
    const cookies = new Map(
      who.cookie
        .split('; ')
        .filter(Boolean)
        .map((item) => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]),
    );
    for (const cookie of response.cookies)
      cookies.set(cookie.name, encodeURIComponent(cookie.value));
    who.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  return response;
}
async function ok(who, method, path, payload, status = 200) {
  const response = await request(who, method, path, payload);
  assert.equal(
    response.statusCode,
    status,
    `${method} ${path.replace(/\/invites\/[^/]+/, '/invites/[token]')} returned ${response.statusCode}`,
  );
  return response.json();
}
async function socket(who) {
  const client = io(address, {
    transports: ['websocket'],
    extraHeaders: { Cookie: who.cookie },
    reconnection: false,
    timeout: 3000,
  });
  sockets.push(client);
  await Promise.race([
    once(client, 'connect'),
    once(client, 'connect_error').then(([error]) => {
      throw error;
    }),
  ]);
  return client;
}
const ack = (client, name, payload) => client.timeout(3000).emitWithAck(name, payload);
const event = (client, name) => once(client, name, { signal: AbortSignal.timeout(4000) });
try {
  for (const label of ['owner', 'member', 'third', 'outsider']) {
    const who = actor();
    who.username = `rel_${label}_${suffix}`;
    who.email = `${who.username}@example.test`;
    const result = await ok(who, 'POST', '/auth/sign-up/email', {
      email: who.email,
      username: who.username,
      name: `Release ${label}`,
      password: `Release!${suffix}Password`,
    });
    who.id = result.user.id;
    actors.push(who);
    assert.equal((await ok(who, 'GET', '/auth/me')).kind, 'user');
  }
  const [owner, member, third, outsider] = actors;
  const group = (
    await ok(owner, 'POST', '/chats/group', {
      title: `Release validation ${suffix}`,
      memberUsernames: [],
    })
  ).chat;
  const other = (
    await ok(outsider, 'POST', '/chats/group', {
      title: `Unrelated ${suffix}`,
      memberUsernames: [],
    })
  ).chat;
  const direct = (await ok(owner, 'POST', '/chats/direct', { username: member.username })).chat;
  assert.equal(direct.type, 'direct');
  assert.equal(
    (await ok(owner, 'POST', '/chats/direct', { username: member.username })).chat.id,
    direct.id,
  );
  pass('registration, session, direct idempotency and group creation');

  const invite = await ok(owner, 'POST', `/chats/${group.id}/invites`, { maxUses: 1 });
  await Promise.all([
    ok(member, 'POST', `/invites/${invite.token}/join`),
    ok(member, 'POST', `/invites/${invite.token}/join`),
  ]);
  assert.equal((await prisma.chatInvite.findUnique({ where: { id: invite.id } })).uses, 1);
  assert.equal((await request(third, 'POST', `/invites/${invite.token}/join`)).statusCode, 410);
  const competitive = await ok(owner, 'POST', `/chats/${group.id}/invites`, { maxUses: 1 });
  const concurrent = await Promise.all([
    request(third, 'POST', `/invites/${competitive.token}/join`),
    request(outsider, 'POST', `/invites/${competitive.token}/join`),
  ]);
  assert.deepEqual(concurrent.map((r) => r.statusCode).sort(), [200, 410]);
  assert.equal((await prisma.chatInvite.findUnique({ where: { id: competitive.id } })).uses, 1);
  const outsiderRoom = (
    await ok(owner, 'POST', '/chats/group', {
      title: 'Access isolation fixture',
      memberUsernames: [],
    })
  ).chat;
  assert.equal((await request(outsider, 'GET', `/chats/${outsiderRoom.id}`)).statusCode, 404);
  pass('PostgreSQL concurrent invite redemption, exhausted limit and room isolation');

  const a = await socket(owner),
    a2 = await socket(owner),
    b = await socket(member);
  for (const client of [a, a2, b])
    assert.equal((await ack(client, 'chat:join', { chatId: group.id })).ok, true);
  const received = event(b, 'message:new');
  assert.equal(
    (await ack(a, 'message:send', { chatId: group.id, text: 'Synthetic realtime check' })).ok,
    true,
  );
  assert.equal((await received)[0].text, 'Synthetic realtime check');
  const typing = event(b, 'typing:update');
  assert.equal((await ack(a, 'typing:start', { chatId: group.id })).ok, true);
  assert.ok((await typing)[0].users.some((u) => u.id === owner.id));
  await ack(a, 'typing:stop', { chatId: group.id });
  for (const client of [a, a2, b])
    assert.equal((await ack(client, 'voice:join', { chatId: group.id })).ok, true);
  assert.equal((await ok(owner, 'GET', `/chats/${group.id}/voice/presence`)).users.length, 2);
  await ack(a, 'voice:left', { chatId: group.id });
  assert.equal((await ok(owner, 'GET', `/chats/${group.id}/voice/presence`)).users.length, 2);
  a2.disconnect();
  let remaining;
  for (let attempt = 0; attempt < 20; attempt++) {
    remaining = (await ok(member, 'GET', `/chats/${group.id}/voice/presence`)).users.map(
      (u) => u.id,
    );
    if (remaining.length === 1) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.deepEqual(remaining, [member.id]);
  assert.equal((await ack(a, 'chat:join', { chatId: other.id })).ok, false);
  pass('real Socket.IO messages, typing, multi-tab voice presence and forbidden room');

  const sameTime = new Date();
  await prisma.message.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      id: `c${suffix}${String(i).padStart(14, '0')}`,
      chatId: direct.id,
      userId: member.id,
      text: `Synthetic page ${i}`,
      createdAt: sameTime,
    })),
  });
  const all = [];
  let cursor;
  do {
    const page = await ok(
      owner,
      'GET',
      `/chats/${direct.id}/messages?limit=3${cursor ? `&cursor=${cursor}` : ''}`,
    );
    all.push(...page.messages.map((m) => m.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(all.length, 12);
  assert.equal(new Set(all).size, 12);
  assert.equal((await ok(owner, 'GET', `/chats/${direct.id}`)).chat.unreadCount, 12);
  await ok(owner, 'POST', `/chats/${direct.id}/read`);
  assert.equal((await ok(owner, 'GET', `/chats/${direct.id}`)).chat.unreadCount, 0);
  pass('stable pagination at identical timestamps and unread/read state');

  const guest = actor();
  const guestInvite = await ok(owner, 'POST', `/chats/${group.id}/invites`, { maxUses: 1 });
  const principal = await ok(guest, 'POST', '/auth/guest/start', { token: guestInvite.token });
  const g = await socket(guest);
  await ack(g, 'chat:join', { chatId: group.id });
  assert.equal(
    (await ok(guest, 'POST', '/auth/guest/start', { token: guestInvite.token })).session.id,
    principal.session.id,
  );
  assert.ok(g.connected);
  assert.equal((await prisma.chatInvite.findUnique({ where: { id: guestInvite.id } })).uses, 1);
  assert.deepEqual(
    (await ok(guest, 'GET', '/chats')).chats.map((c) => c.id),
    [group.id],
  );
  for (const path of [
    `/chats/${other.id}`,
    `/chats/${other.id}/messages`,
    `/chats/${other.id}/voice/presence`,
  ])
    assert.equal((await request(guest, 'GET', path)).statusCode, 404);
  assert.equal((await request(guest, 'POST', '/chats/group', { title: 'Denied' })).statusCode, 401);
  const message = (
    await ok(guest, 'POST', `/chats/${group.id}/messages`, { text: 'Synthetic guest message' })
  ).message;
  assert.equal(message.userId, principal.user.id);
  const stored = await prisma.message.findUnique({ where: { id: message.id } });
  assert.equal(stored.userId, null);
  assert.equal(stored.guestSessionId, principal.session.id);
  assert.equal(
    (await ack(g, 'message:send', { chatId: group.id, text: 'Guest socket message' })).ok,
    true,
  );
  pass('guest repeated entry preserves sockets, FK-safe messages and scoped HTTP/Socket.IO rights');

  const form = new FormData();
  form.append('text', 'Synthetic guest file');
  form.append(
    'file',
    new Blob(['Release attachment bytes'], { type: 'text/plain' }),
    'release-check.txt',
  );
  const uploaded = await fetch(`${address}/chats/${group.id}/attachments`, {
    method: 'POST',
    headers: { Cookie: guest.cookie, Origin: process.env.APP_URL },
    body: form,
  });
  assert.equal(uploaded.status, 201);
  const fileMessage = (await uploaded.json()).message;
  assert.equal(fileMessage.userId, principal.user.id);
  const attachment = fileMessage.attachments[0];
  const link = await ok(guest, 'GET', `/chats/${group.id}/attachments/${attachment.id}/url`);
  const content = await request(guest, 'GET', link.url);
  assert.equal(content.statusCode, 200);
  assert.equal(content.body, 'Release attachment bytes');
  assert.equal((await request(owner, 'GET', link.url)).statusCode, 403);
  assert.equal(
    (await request(guest, 'GET', `/chats/${other.id}/attachments/${attachment.id}/url`)).statusCode,
    404,
  );
  await prisma.attachment.update({
    where: { id: attachment.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal((await request(guest, 'GET', link.url)).statusCode, 410);
  const storage = new FilesystemStorageAdapter(process.env.ATTACHMENTS_STORAGE_ROOT);
  await cleanupExpiredAttachments(prisma, storage, app.log);
  const expired = await prisma.attachment.findUnique({ where: { id: attachment.id } });
  assert.ok(expired.storageDeletedAt);
  assert.ok(await prisma.message.findUnique({ where: { id: fileMessage.id } }));
  await assert.rejects(stat(join(process.env.ATTACHMENTS_STORAGE_ROOT, expired.storageKey)), {
    code: 'ENOENT',
  });
  pass(
    'guest upload/download, principal-bound signed URLs, expiry, real filesystem deletion and retained message',
  );

  const revoked = await ok(owner, 'POST', `/chats/${group.id}/invites`, {});
  await ok(owner, 'DELETE', `/chats/${group.id}/invites/${revoked.id}`);
  for (const path of ['/auth/guest/start', `/invites/${revoked.token}/join`]) {
    const who = path.startsWith('/auth') ? actor() : outsider;
    assert.equal((await request(who, 'POST', path, { token: revoked.token })).statusCode, 410);
  }
  const expiredInvite = await ok(owner, 'POST', `/chats/${group.id}/invites`, {});
  await prisma.chatInvite.update({
    where: { id: expiredInvite.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal(
    (await request(actor(), 'POST', '/auth/guest/start', { token: expiredInvite.token }))
      .statusCode,
    410,
  );
  assert.equal(
    (await request(actor(), 'POST', '/auth/guest/start', { token: guestInvite.token })).statusCode,
    410,
  );
  await prisma.guestSession.update({
    where: { id: principal.session.id },
    data: { expiresAt: new Date(Date.now() + 300) },
  });
  const short = await socket(guest);
  await event(short, 'disconnect');
  assert.equal((await request(guest, 'GET', `/chats/${group.id}/messages`)).statusCode, 401);
  assert.equal(
    (await ack(g, 'message:send', { chatId: group.id, text: 'Denied after expiry' })).ok,
    false,
  );
  await ok(guest, 'POST', '/auth/guest/sign-out');
  pass(
    'revoked, expired and exhausted guest entry; connected socket and HTTP expiry; guest logout',
  );

  const disconnected = event(a, 'disconnect');
  await ok(owner, 'POST', '/auth/sign-out');
  await disconnected;
  assert.equal((await request(owner, 'GET', '/auth/me')).statusCode, 401);
  await ok(owner, 'POST', '/auth/sign-in/email', {
    email: owner.email,
    password: `Release!${suffix}Password`,
  });
  assert.equal((await ok(owner, 'GET', '/auth/me')).user.id, owner.id);
  pass('account logout revokes session sockets and login restores access');
  console.log(
    'Release integration checks: PASS (real isolated PostgreSQL, Valkey, HTTP, Socket.IO and filesystem; LiveKit media tested separately)',
  );
} finally {
  sockets.forEach((client) => client.disconnect());
  await new Promise((done) => setTimeout(done, 100));
  await app.close();
  await valkey.quit().catch(() => undefined);
}
