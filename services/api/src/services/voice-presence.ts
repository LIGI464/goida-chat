import { valkey } from '../lib/valkey.js';
import { getPresenceUsers } from './presence.js';

function voiceKey(chatId: string) {
  return `voice:chat:${chatId}:users`;
}
function voiceSocketKey(chatId: string, userId: string) {
  return `voice:chat:${chatId}:user:${userId}:sockets`;
}

export async function addVoicePresence(chatId: string, userId: string, socketId?: string) {
  if (!socketId) return valkey.sadd(voiceKey(chatId), userId);
  await valkey.sadd(voiceSocketKey(chatId, userId), socketId);
  await valkey.sadd(voiceKey(chatId), userId);
}

export async function removeVoicePresence(chatId: string, userId: string, socketId?: string) {
  if (!socketId) {
    await valkey.del(voiceSocketKey(chatId, userId));
    return valkey.srem(voiceKey(chatId), userId);
  }
  await valkey.srem(voiceSocketKey(chatId, userId), socketId);
  if ((await valkey.scard(voiceSocketKey(chatId, userId))) === 0) {
    await valkey.del(voiceSocketKey(chatId, userId));
    await valkey.srem(voiceKey(chatId), userId);
  }
}

export async function getVoicePresence(chatId: string) {
  const userIds = await valkey.smembers(voiceKey(chatId));
  if (userIds.length === 0) return [];

  return getPresenceUsers(chatId, userIds);
}
