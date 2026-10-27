const defaultApiUrl = import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin;
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

export const apiUrl = (configuredApiUrl || defaultApiUrl).replace(/\/+$/, '');

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
  createdById?: string | null;
  displayTitle?: string | null;
  createdAt: string;
  updatedAt: string;
  members: ChatMember[];
  lastMessage: Message | null;
  unreadCount?: number;
  onlineMemberIds?: string[];
};

export type SessionUser = PublicUser & {
  email: string | null;
};

export type PrincipalSession = {
  kind: 'user' | 'guest';
  user: SessionUser;
  session: { id: string; expiresAt: string };
  chatId?: string;
  inviteToken?: string;
};

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export type VoiceToken = {
  token: string;
  url: string;
  roomName: string;
};

export type ChatInvite = {
  id: string;
  token: string;
  url: string;
  chatId: string;
  createdById: string;
  expiresAt: string;
  revokedAt: string | null;
  maxUses: number | null;
  uses: number;
  remainingUses: number | null;
  createdAt: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Не удалось подключиться к API. Проверь адрес сервера и попробуй ещё раз.');
    }

    throw error;
  }

  if (!response.ok) {
    const errorResponse = response.clone();
    const payload = await errorResponse.json().catch(() => null);
    const fallbackText = await response
      .text()
      .then((value) => value.trim())
      .catch(() => '');
    const errorText =
      payload?.message ??
      payload?.error ??
      (fallbackText || `API request failed with status ${response.status}`);

    throw new ApiError(errorText, response.status);
  }

  return response.json() as Promise<T>;
}

export const api = {
  async getSession() {
    try { return await apiFetch<PrincipalSession>('/auth/me'); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  startGuestSession(token: string) {
    return apiFetch<PrincipalSession>('/auth/guest/start', {
      method: 'POST', body: JSON.stringify({ token }),
    });
  },
  endGuestSession() {
    return apiFetch<{ ok: true }>('/auth/guest/sign-out', { method: 'POST' });
  },
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
  createInvite(chatId: string, options?: { expiresInHours?: number; maxUses?: number | null }) {
    return apiFetch<ChatInvite>(`/chats/${chatId}/invites`, {
      method: 'POST',
      ...(options ? { body: JSON.stringify(options) } : {}),
    });
  },
  listInvites(chatId: string) {
    return apiFetch<{ invites: ChatInvite[] }>(`/chats/${chatId}/invites`);
  },
  revokeInvite(chatId: string, inviteId: string) {
    return apiFetch<{ ok: true }>(`/chats/${chatId}/invites/${inviteId}`, { method: 'DELETE' });
  },
  joinInvite(token: string) {
    return apiFetch<{ chatId: string }>(`/invites/${encodeURIComponent(token)}/join`, { method: 'POST' });
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
