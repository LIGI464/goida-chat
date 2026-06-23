import { io, type Socket } from 'socket.io-client';

import { apiUrl, type Message, type PublicUser } from './api';

export type ServerToClientEvents = {
  'message:new': (message: Message) => void;
  'message:error': (payload: { message: string }) => void;
  'voice:presence:update': (payload: { chatId: string; users: PublicUser[] }) => void;
  'chat:updated': (chat: unknown) => void;
};

export type Ack<T = unknown> = (
  response: { ok: true; data?: T } | { ok: false; error: string },
) => void;

export type ClientToServerEvents = {
  'chat:join': (payload: { chatId: string }, ack?: Ack) => void;
  'chat:leave': (payload: { chatId: string }, ack?: Ack) => void;
  'message:send': (payload: { chatId: string; text: string }, ack?: Ack<Message>) => void;
  'voice:join': (payload: { chatId: string }, ack?: Ack) => void;
  'voice:left': (payload: { chatId: string }, ack?: Ack) => void;
};

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createChatSocket() {
  return io(apiUrl, {
    withCredentials: true,
  }) as ChatSocket;
}
