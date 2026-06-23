const defaultApiUrl = import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin;

export const apiUrl = import.meta.env.VITE_API_URL || defaultApiUrl;

export type PublicUser = {
  id: string;
  name: string;
  username?: string | null;
  displayUsername?: string | null;
  image?: string | null;
};

export type ChatMember = {
  id: string;
  joinedAt: string;
  user: PublicUser;
};

export type Message = {
  id: string;
  chatId: string;
  userId: string;
  text: string;
  createdAt: string;
  editedAt?: string | null;
  user: PublicUser;
};

export type Chat = {
  id: string;
  type: 'direct' | 'group';
  title?: string | null;
  displayTitle?: string | null;
  createdAt: string;
  updatedAt: string;
  members: ChatMember[];
  lastMessage: Message | null;
};

export type VoiceToken = {
  token: string;
  url: string;
  roomName: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? payload?.error ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  searchUsers(username: string) {
    return apiFetch<{ users: PublicUser[] }>(
      `/users/search?username=${encodeURIComponent(username)}`,
    );
  },
  listChats() {
    return apiFetch<{ chats: Chat[] }>('/chats');
  },
  createDirectChat(username: string) {
    return apiFetch<{ chat: Chat }>('/chats/direct', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  },
  createGroupChat(title: string, memberUsernames: string[]) {
    return apiFetch<{ chat: Chat }>('/chats/group', {
      method: 'POST',
      body: JSON.stringify({ title, memberUsernames }),
    });
  },
  getMessages(chatId: string) {
    return apiFetch<{ messages: Message[]; nextCursor: string | null }>(
      `/chats/${chatId}/messages`,
    );
  },
  sendMessage(chatId: string, text: string) {
    return apiFetch<{ message: Message }>(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },
  getVoiceToken(chatId: string) {
    return apiFetch<VoiceToken>(`/chats/${chatId}/voice/token`, { method: 'POST' });
  },
  getVoicePresence(chatId: string) {
    return apiFetch<{ users: PublicUser[] }>(`/chats/${chatId}/voice/presence`);
  },
};
