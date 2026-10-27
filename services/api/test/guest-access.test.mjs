import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { io as connect } from 'socket.io-client';
import { RoomServiceClient } from 'livekit-server-sdk';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/guest_test',
  VALKEY_URL: 'redis://127.0.0.1:1',
  APP_URL: 'http://localhost:5173',
  COOKIE_SECRET: 'guest-test-cookie-secret-at-least-32-characters',
  BETTER_AUTH_SECRET: 'guest-test-auth-secret-at-least-32-characters',
  LIVEKIT_API_KEY: 'guest-test',
  LIVEKIT_API_SECRET: 'guest-test-secret',
});

const { auth } = await import('../src/auth.ts');
const { prisma } = await import('../src/lib/prisma.ts');
const { valkey } = await import('../src/lib/valkey.ts');
const { guestCookies } = await import('../src/lib/principal.ts');
const { removeExpiredGuestVoice } = await import('../src/services/guest-voice.ts');
const { buildApp } = await import('../src/app.ts');

// Exercise actual HTTP routes, signed cookies, Socket.IO and LiveKit JWT creation.
// External database/Redis/LiveKit operations use deterministic in-memory fixtures.
test('scoped guest access across HTTP, sockets and voice', async (t) => {
  const guests = new Map();
  const messages = [];
  const sets = new Map();
  const counters = new Map();
  const voiceExpirations = new Map();
  const removedVoice = [];
  let registered = false;
  const chatId = 'cm00000000000000000000001';
  const otherChatId = 'cm00000000000000000000002';
  const token = 'valid_invite_token_123456789';
  const user = { id: 'user-owner', name: 'Owner', username: 'owner', email: 'owner@example.test' };
  const invite = {
    id: 'invite-test',
    token,
    chatId,
    expiresAt: new Date(Date.now() + 86400_000),
    revokedAt: null,
    maxUses: 2,
    uses: 0,
    chat: { type: 'group' },
  };
  const activeGuest = (query) =>
    [...guests.values()].filter(
      (guest) =>
        (!query?.id || guest.id === query.id) &&
        (!query?.chatId || guest.chatId === query.chatId) &&
        (!query?.guestId?.in || query.guestId.in.includes(guest.guestId)) &&
        (!query?.expiresAt?.gt || guest.expiresAt > query.expiresAt.gt),
    );
  const chat = () => ({
    id: chatId,
    type: 'group',
    title: 'Invite room',
    createdById: user.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    voiceRoom: null,
    members: [{ id: 'member-owner', userId: user.id, joinedAt: new Date(), user }],
    guestSessions: [...guests.values()],
    messages: messages.slice(-1).reverse(),
  });

  mock.method(auth.api, 'getSession', async () =>
    registered
      ? { user, session: { id: 'account-session', expiresAt: new Date(Date.now() + 60_000) } }
      : null,
  );
  // Prisma delegates are proxies, so node:test's descriptor-based mock.method cannot wrap them.
  const stub = (object, method, implementation) => {
    object[method] = implementation;
  };
  stub(prisma, '$queryRaw', async () => []);
  stub(prisma.chatInvite, 'findUnique', async ({ where }) =>
    where.token === token ? invite : null,
  );
  stub(prisma.chatInvite, 'update', async () => {
    invite.uses++;
    return invite;
  });
  stub(prisma.attachment, 'updateMany', async () => ({ count: 0 }));
  stub(prisma.attachment, 'findMany', async () => []);
  stub(prisma.guestSession, 'findUnique', async ({ where }) => guests.get(where.id) ?? null);
  stub(prisma.guestSession, 'findFirst', async ({ where }) => activeGuest(where)[0] ?? null);
  stub(prisma.guestSession, 'findMany', async ({ where }) => activeGuest(where));
  stub(prisma.guestSession, 'create', async ({ data }) => {
    const guest = { ...data, id: randomUUID(), createdAt: new Date() };
    guests.set(guest.id, guest);
    return guest;
  });
  stub(prisma.guestSession, 'updateMany', async ({ where, data }) => {
    const guest = guests.get(where.id);
    if (guest) Object.assign(guest, data);
    return { count: guest ? 1 : 0 };
  });
  stub(prisma, '$transaction', async (callback) => callback(prisma));
  stub(prisma.chat, 'findMany', async ({ where }) => (where.id === chatId ? [chat()] : []));
  stub(prisma.chat, 'findUnique', async ({ where }) => (where.id === chatId ? chat() : null));
  stub(prisma.chat, 'update', async () => chat());
  stub(prisma.chatMember, 'findUnique', async () => null);
  stub(prisma.chatMember, 'findMany', async () => [{ userId: user.id }]);
  stub(prisma.user, 'findMany', async () => []);
  stub(prisma.message, 'create', async ({ data }) => {
    const message = {
      ...data,
      id: `cm${String(messages.length).padStart(23, '0')}`,
      createdAt: new Date(),
      editedAt: null,
      user: null,
      attachments: [],
      guestSession: guests.get(data.guestSessionId),
    };
    messages.push(message);
    return message;
  });
  stub(prisma.message, 'findMany', async ({ where }) =>
    messages.filter((message) => message.chatId === where.chatId),
  );
  stub(prisma.voiceRoom, 'upsert', async ({ create }) => create);
  stub(prisma, '$disconnect', async () => undefined);
  mock.method(valkey, 'eval', async (_script, _count, key) => {
    const value = (counters.get(key) ?? 0) + 1;
    counters.set(key, value);
    return value;
  });
  mock.method(valkey, 'sadd', async (key, value) => {
    const set = sets.get(key) ?? new Set();
    const added = set.has(value) ? 0 : 1;
    set.add(value);
    sets.set(key, set);
    return added;
  });
  mock.method(valkey, 'srem', async (key, value) => (sets.get(key)?.delete(value) ? 1 : 0));
  mock.method(valkey, 'smembers', async (key) => [...(sets.get(key) ?? [])]);
  mock.method(valkey, 'scard', async (key) => sets.get(key)?.size ?? 0);
  mock.method(valkey, 'del', async (...keys) => keys.forEach((key) => sets.delete(key)));
  mock.method(valkey, 'pipeline', () => ({
    sismember() {
      return this;
    },
    async exec() {
      return [];
    },
  }));
  mock.method(valkey, 'zadd', async (_key, score, entry) => voiceExpirations.set(entry, score));
  mock.method(valkey, 'zscore', async (_key, entry) => voiceExpirations.get(entry) ?? null);
  mock.method(valkey, 'zrem', async (_key, entry) => voiceExpirations.delete(entry));
  mock.method(valkey, 'zrangebyscore', async () => []);
  mock.method(valkey, 'disconnect', () => undefined);
  mock.method(RoomServiceClient.prototype, 'removeParticipant', async (room, id) => {
    removedVoice.push({ room, id });
  });

  const app = await buildApp();
  app.log.level = 'silent';
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const sockets = [];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await app.close();
    mock.restoreAll();
  });
  const request = (method, url, payload, cookie) =>
    app.inject({
      method,
      url,
      headers: { ...(cookie ? { cookie } : {}), origin: 'http://localhost:5173' },
      ...(payload ? { payload } : {}),
    });
  let cookie;
  let principal;
  let socket;
  const ack = (client, event, payload) => client.timeout(1500).emitWithAck(event, payload);
  const openSocket = async (sessionCookie) => {
    const client = connect(address, {
      transports: ['websocket'],
      extraHeaders: { Cookie: sessionCookie },
      reconnection: false,
    });
    sockets.push(client);
    await Promise.race([
      once(client, 'connect'),
      once(client, 'connect_error').then(([error]) => {
        throw error;
      }),
    ]);
    return client;
  };

  await t.test(
    'requires a valid invite and issues a signed HttpOnly cookie without creating a User',
    async () => {
      assert.equal(
        (await request('POST', '/auth/guest/start', { token: 'unknown_invite_token_123' }))
          .statusCode,
        404,
      );
      const result = await request('POST', '/auth/guest/start', { token });
      assert.equal(result.statusCode, 200, result.body);
      principal = result.json();
      assert.equal(principal.kind, 'guest');
      assert.match(principal.user.id, /^guest_/);
      assert.match(principal.user.name, /^Гость /);
      assert.equal(principal.user.email, null);
      assert.ok(new Date(principal.session.expiresAt).getTime() - Date.now() <= 7_200_000);
      const header = result.headers['set-cookie'];
      assert.match(header, /HttpOnly/);
      assert.match(header, /SameSite=Lax/);
      cookie = header.split(';')[0];
      assert.equal(guestCookies.read(cookie), principal.session.id);
    },
  );
  await t.test(
    'rejects tampered and malformed cookies; scopes HTTP reads and denies room management',
    async () => {
      assert.equal((await request('GET', '/auth/me', null, `${cookie}bad`)).statusCode, 401);
      assert.equal(
        (await request('GET', '/auth/me', null, 'goida-guest-session=%not-valid')).statusCode,
        401,
      );
      assert.equal((await request('GET', '/auth/me', null, cookie)).json().kind, 'guest');
      const chats = await request('GET', '/chats', null, cookie);
      assert.deepEqual(
        chats.json().chats.map((item) => item.id),
        [chatId],
      );
      for (const path of [
        `/chats/${otherChatId}`,
        `/chats/${otherChatId}/messages`,
        `/chats/${otherChatId}/voice/presence`,
      ]) {
        assert.equal((await request('GET', path, null, cookie)).statusCode, 404, path);
      }
      for (const [method, path] of [
        ['POST', '/chats/group'],
        ['POST', '/chats/direct'],
        ['PATCH', `/chats/${chatId}`],
        ['POST', `/chats/${chatId}/members`],
        ['POST', `/chats/${chatId}/invites`],
      ]) {
        assert.equal((await request(method, path, {}, cookie)).statusCode, 401, path);
      }
      assert.equal(
        (await request('POST', `/chats/${otherChatId}/messages`, { text: 'forbidden' }, cookie))
          .statusCode,
        404,
      );
      assert.equal(
        (await request('POST', '/auth/guest/start', { token }, cookie)).json().session.id,
        principal.session.id,
      );
    },
  );
  await t.test('uses the guest principal for sockets, messages and voice presence', async () => {
    socket = await openSocket(cookie);
    assert.equal((await ack(socket, 'chat:join', { chatId: otherChatId })).ok, false);
    assert.equal((await ack(socket, 'voice:join', { chatId: otherChatId })).ok, false);
    assert.equal((await ack(socket, 'typing:stop', { chatId: otherChatId })).ok, false);
    assert.equal((await ack(socket, 'chat:join', { chatId })).ok, true);
    const sent = await ack(socket, 'message:send', { chatId, text: 'guest message' });
    assert.equal(sent.ok, true, sent.error);
    assert.equal(sent.data.userId, principal.user.id);
    assert.equal(sent.data.user.name, principal.user.name);
    assert.equal((await ack(socket, 'voice:join', { chatId })).ok, true);
    const voice = await request('GET', `/chats/${chatId}/voice/presence`, null, cookie);
    assert.deepEqual(
      voice.json().users.map((item) => item.id),
      [principal.user.id],
    );
    const tokenResult = await request('POST', `/chats/${chatId}/voice/token`, null, cookie);
    assert.equal(tokenResult.statusCode, 200, tokenResult.body);
    const claims = JSON.parse(
      Buffer.from(tokenResult.json().token.split('.')[1], 'base64url').toString(),
    );
    assert.equal(claims.sub, principal.user.id);
    assert.equal(claims.video.room, `chat_${chatId}_voice`);
    assert.ok(claims.exp * 1000 <= new Date(principal.session.expiresAt).getTime());
    assert.equal(voiceExpirations.size, 1);
    assert.equal(
      (await request('POST', `/chats/${otherChatId}/voice/token`, null, cookie)).statusCode,
      404,
    );
  });
  await t.test('shares the guest message limit across HTTP and multiple sockets', async () => {
    const second = await openSocket(cookie);
    for (let count = 0; count < 8; count += 1) {
      assert.equal(
        (await ack(second, 'message:send', { chatId, text: `message ${count}` })).ok,
        true,
      );
    }
    assert.equal(
      (await request('POST', `/chats/${chatId}/messages`, { text: 'tenth' }, cookie)).statusCode,
      200,
    );
    assert.equal((await ack(socket, 'message:send', { chatId, text: 'over limit' })).ok, false);
    assert.equal(
      (await request('POST', `/chats/${chatId}/messages`, { text: 'over limit' }, cookie))
        .statusCode,
      429,
    );
  });
  await t.test(
    'revokes active sockets and voice on sign-out; preserves account precedence',
    async () => {
      registered = true;
      assert.equal((await request('GET', '/auth/me', null, cookie)).json().kind, 'user');
      registered = false;
      const disconnected = once(socket, 'disconnect');
      assert.equal((await request('POST', '/auth/guest/sign-out', null, cookie)).statusCode, 200);
      await disconnected;
      assert.equal((await request('GET', '/auth/me', null, cookie)).statusCode, 401);
      await removeExpiredGuestVoice({ id: principal.user.id, chatId, session: principal.session });
      assert.ok(removedVoice.some((item) => item.id === principal.user.id));
    },
  );
  await t.test(
    'expires an already connected guest socket and rejects later HTTP requests',
    async () => {
      const expiring = {
        id: 'short-session',
        guestId: 'guest_short',
        displayName: 'Short guest',
        inviteToken: token,
        chatId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 200),
      };
      guests.set(expiring.id, expiring);
      const shortCookie = `goida-guest-session=${encodeURIComponent(guestCookies.sign(expiring.id))}`;
      const shortSocket = await openSocket(shortCookie);
      await once(shortSocket, 'disconnect');
      assert.equal((await request('GET', '/chats', null, shortCookie)).statusCode, 401);
    },
  );
});
