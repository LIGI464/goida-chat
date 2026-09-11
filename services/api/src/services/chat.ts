import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/http.js';
import { publicUser } from '../lib/session.js';

export const publicUserSelect = {
  id: true,
  name: true,
  username: true,
  displayUsername: true,
  image: true,
} satisfies Prisma.UserSelect;

export const messageSelect = {
  id: true,
  chatId: true,
  userId: true,
  text: true,
  createdAt: true,
  editedAt: true,
  user: { select: publicUserSelect },
} satisfies Prisma.MessageSelect;

export const chatInclude = {
  members: {
    orderBy: { joinedAt: 'asc' as const },
    include: { user: { select: publicUserSelect } },
  },
  messages: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: messageSelect,
  },
  voiceRoom: true,
} satisfies Prisma.ChatInclude;

export type ChatWithDetails = Prisma.ChatGetPayload<{ include: typeof chatInclude }>;
export type MessageWithUser = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

export async function ensureChatMember(userId: string, chatId: string) {
  const member = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });

  if (!member) {
    throw notFound('Chat not found');
  }

  return member;
}

export function livekitRoomName(chatId: string) {
  return `chat_${chatId}_voice`;
}

export async function ensureVoiceRoom(chatId: string) {
  return prisma.voiceRoom.upsert({
    where: { chatId },
    update: {},
    create: {
      chatId,
      livekitRoomName: livekitRoomName(chatId),
    },
  });
}

export function serializeMessage(message: MessageWithUser) {
  return {
    id: message.id,
    chatId: message.chatId,
    userId: message.userId,
    text: message.text,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    user: publicUser(message.user),
  };
}

export function serializeChat(chat: ChatWithDetails, currentUserId: string) {
  const members = chat.members.map((member) => ({
    id: member.id,
    joinedAt: member.joinedAt,
    user: publicUser(member.user),
  }));
  const directPeer =
    chat.type === 'direct' ? members.find((member) => member.user.id !== currentUserId) : null;
  const displayTitle =
    chat.type === 'direct' ? `@${directPeer?.user.username ?? 'unknown'}` : chat.title;

  return {
    id: chat.id,
    type: chat.type,
    title: chat.title,
    createdById: chat.createdById,
    displayTitle,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    members,
    lastMessage: chat.messages[0] ? serializeMessage(chat.messages[0]) : null,
    unreadCount: 0,
    voiceRoom: chat.voiceRoom,
  };
}

export async function loadChatForUser(chatId: string, userId: string) {
  await ensureChatMember(userId, chatId);
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: chatInclude,
  });

  if (!chat) {
    throw notFound('Chat not found');
  }

  return serializeChat(chat, userId);
}

export async function createTextMessage(chatId: string, userId: string, text: string) {
  await ensureChatMember(userId, chatId);
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: { chatId, userId, text },
      select: messageSelect,
    });
    await tx.chatMember.update({
      where: { chatId_userId: { chatId, userId } },
      data: { lastReadMessageId: created.id },
    });
    await tx.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });
    return created;
  });

  return serializeMessage(message);
}
