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
  unreadCount?: number;
  onlineMemberIds?: string[];
};

export type SessionUser = PublicUser & {
  email: string;
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
  addChatMember(chatId: string, username: string) {
    return apiFetch<{ chat: Chat }>(`/chats/${chatId}/members`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  },
  getMessages(chatId: string, cursor?: string) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return apiFetch<{ messages: Message[]; nextCursor: string | null }>(
      `/chats/${chatId}/messages${suffix}`,
    );
  },
  markChatRead(chatId: string) {
    return apiFetch<{ ok: true }>(`/chats/${chatId}/read`, { method: 'POST' });
  },
  startTyping(chatId: string) {
    return apiFetch<{ ok: true }>(`/chats/${chatId}/typing/start`, { method: 'POST' });
  },
  stopTyping(chatId: string) {
    return apiFetch<{ ok: true }>(`/chats/${chatId}/typing/stop`, { method: 'POST' });
  },
  sendMessage(chatId: string, text: string) {
    return apiFetch<{ message: Message }>(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },
  renameChat(chatId: string, title: string) {
    return apiFetch<{ chat: Chat }>(`/chats/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },
  deleteChat(chatId: string) {
    return apiFetch<{ ok: true }>(`/chats/${chatId}`, {
      method: 'DELETE',
    });
  },
  leaveGroupChat(chatId: string) {
    return apiFetch<{ ok: true }>(`/chats/${chatId}/members/me`, {
      method: 'DELETE',
    });
  },
  getVoiceToken(chatId: string) {
    return apiFetch<VoiceToken>(`/chats/${chatId}/voice/token`, { method: 'POST' });
  },
  getVoicePresence(chatId: string) {
    return apiFetch<{ users: PublicUser[] }>(`/chats/${chatId}/voice/presence`);
  },
  getMe() {
    return apiFetch<{ user: SessionUser; session: { id: string; expiresAt: string } }>('/auth/me');
  },
  updateProfile(username: string) {
    return apiFetch<{ user: PublicUser }>('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ username }),
    });
  },
};
