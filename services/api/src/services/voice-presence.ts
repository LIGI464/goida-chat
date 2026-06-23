import { prisma } from '../lib/prisma.js';
import { valkey } from '../lib/valkey.js';
import { publicUserSelect } from './chat.js';
import { publicUser } from '../lib/session.js';

function voiceKey(chatId: string) {
  return `voice:chat:${chatId}:users`;
}

export async function addVoicePresence(chatId: string, userId: string) {
  await valkey.sadd(voiceKey(chatId), userId);
}

export async function removeVoicePresence(chatId: string, userId: string) {
  await valkey.srem(voiceKey(chatId), userId);
}

export async function getVoicePresence(chatId: string) {
  const userIds = await valkey.smembers(voiceKey(chatId));
  if (userIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: publicUserSelect,
  });

  return users.map(publicUser);
}
