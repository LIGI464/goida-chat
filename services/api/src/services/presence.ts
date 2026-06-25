import { prisma } from '../lib/prisma.js';
import { valkey } from '../lib/valkey.js';

const ONLINE_USERS_KEY = 'presence:online:users';

function socketKey(userId: string) {
  return `presence:user:${userId}:sockets`;
}

function typingKey(chatId: string) {
  return `presence:chat:${chatId}:typing`;
}

export async function addOnlineSocket(userId: string, socketId: string) {
  await valkey.sadd(socketKey(userId), socketId);
  const isNewlyOnline = await valkey.sadd(ONLINE_USERS_KEY, userId);
  return isNewlyOnline === 1;
}

export async function removeOnlineSocket(userId: string, socketId: string) {
  await valkey.srem(socketKey(userId), socketId);
  const remainingSockets = await valkey.scard(socketKey(userId));
  if (remainingSockets > 0) return false;

  await valkey.del(socketKey(userId));
  const removed = await valkey.srem(ONLINE_USERS_KEY, userId);
  return removed === 1;
}

export async function getOnlineUserIds(userIds: string[]) {
  if (userIds.length === 0) return [];

  const pipeline = valkey.pipeline();
  for (const userId of userIds) {
    pipeline.sismember(ONLINE_USERS_KEY, userId);
  }
  const results = await pipeline.exec();

  return userIds.filter((userId, index) => results?.[index]?.[1] === 1);
}

export async function addTypingPresence(chatId: string, userId: string) {
  await valkey.sadd(typingKey(chatId), userId);
}

export async function removeTypingPresence(chatId: string, userId: string) {
  await valkey.srem(typingKey(chatId), userId);
}

export async function clearTypingPresence(userId: string, chatIds: Iterable<string>) {
  const items = [...chatIds];
  if (items.length === 0) return;

  const pipeline = valkey.pipeline();
  for (const chatId of items) {
    pipeline.srem(typingKey(chatId), userId);
  }
  await pipeline.exec();
}

export async function getTypingUsers(chatId: string) {
  const userIds = await valkey.smembers(typingKey(chatId));
  if (userIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      name: true,
      username: true,
      displayUsername: true,
      image: true,
    },
  });

  return users;
}
