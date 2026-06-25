import { signInSchema, signUpSchema } from '@goida-chat/shared';
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Suspense,
  lazy,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { api, type Chat, type Message, type PublicUser } from './lib/api';
import { authClient } from './lib/auth-client';
import { createChatSocket, type ChatSocket } from './lib/socket';

const VoicePanel = lazy(() =>
  import('./components/VoicePanel').then((module) => ({ default: module.VoicePanel })),
);

const TERRARIA_ROOM_NAMES = [
  'Amber Hollow',
  'Sunplate Garden',
  'Ashen Lantern',
  'Mossy Archive',
  'Skyforge Nest',
  'Crystal Burrow',
  'Hallowed Cavern',
  'Obsidian Camp',
  'Pearlwood Relay',
  'Starfury Den',
  'Shimmer Vault',
  'Jungle Beacon',
];

const registrationSchema = signUpSchema
  .extend({ repeatPassword: z.string() })
  .refine((value) => value.password === value.repeatPassword, {
    path: ['repeatPassword'],
    message: 'Пароли не совпадают',
  });

type MessagesPage = { messages: Message[]; nextCursor: string | null };
type ChatListData = { chats: Chat[] };
type CurrentUser = { id: string; name: string; username?: string | null };
type MessagesInfinite = InfiniteData<MessagesPage, string | null>;

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return 'Что-то пошло не так. Попробуй ещё раз.';
}

function randomRoomTitle() {
  return TERRARIA_ROOM_NAMES[Math.floor(Math.random() * TERRARIA_ROOM_NAMES.length)]!;
}

function normalizeUserSearch(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, '');
}

function formatChatTime(value?: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function LoadingScreen() {
  return <main className="grid min-h-screen place-items-center text-[var(--muted)]">Загрузка...</main>;
}

function appendMessageToPages(
  data: MessagesInfinite | undefined,
  message: Message,
): MessagesInfinite {
  if (!data) {
    return {
      pages: [{ messages: [message], nextCursor: null }],
      pageParams: [null],
    };
  }

  if (data.pages.some((page) => page.messages.some((item) => item.id === message.id))) {
    return data;
  }

  const pages = [...data.pages];
  const latestPage = pages[0] ?? { messages: [], nextCursor: null };
  pages[0] = { ...latestPage, messages: [...latestPage.messages, message] };

  return { ...data, pages };
}

function upsertChat(data: ChatListData | undefined, chat: Chat): ChatListData | undefined {
  if (!data) return data;
  return { chats: [chat, ...data.chats.filter((item) => item.id !== chat.id)] };
}

function patchChatsWithMessage(
  data: ChatListData | undefined,
  message: Message,
  currentUserId: string | null,
  selectedChatId: string | null,
): ChatListData | undefined {
  if (!data) return data;

  const index = data.chats.findIndex((chat) => chat.id === message.chatId);
  if (index === -1) return data;

  const current = data.chats[index]!;
  const unreadCount =
    message.userId === currentUserId || current.id === selectedChatId ? 0 : (current.unreadCount ?? 0) + 1;
  const updated: Chat = {
    ...current,
    lastMessage: message,
    updatedAt: message.createdAt,
    unreadCount,
  };

  const chats = [...data.chats];
  chats.splice(index, 1);
  chats.unshift(updated);

  return { chats };
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  if (isPending) return <LoadingScreen />;
  if (data) return <Navigate to="/app" replace />;
  return children;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, isPending } = authClient.useSession();
  if (isPending) return <LoadingScreen />;
  if (!data) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

function AuthCard({ mode }: { mode: 'login' | 'register' }) {
  const register = mode === 'register';
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      if (register) {
        const input = registrationSchema.parse({ email, username, password, repeatPassword });
        const result = await authClient.signUp.email({
          email: input.email,
          password: input.password,
          name: input.username,
          username: input.username,
          displayUsername: input.username,
        });
        if (result.error) throw result.error;
      } else {
        const input = signInSchema.parse({ email, password });
        const result = await authClient.signIn.email({
          email: input.email,
          password: input.password,
          rememberMe: true,
        });
        if (result.error) throw result.error;
      }

      const from = (location.state as { from?: string } | null)?.from ?? '/app';
      navigate(from, { replace: true });
    } catch (caught) {
      if (caught instanceof z.ZodError) {
        setError(caught.issues[0]?.message ?? 'Проверь введённые данные');
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <section className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl">
        <h1 className="mb-1 text-2xl font-semibold">{register ? 'Регистрация' : 'Вход'}</h1>
        <p className="mb-5 text-sm text-[var(--muted)]">
          {register ? 'Создай приватный аккаунт' : 'С возвращением'}
        </p>
        <form className="grid gap-3" onSubmit={submit}>
          <input
            autoComplete="email"
            className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 outline-none focus:ring-2 focus:ring-[var(--accent)]"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
            type="email"
            value={email}
          />
          {register && (
            <input
              autoComplete="username"
              className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 outline-none focus:ring-2 focus:ring-[var(--accent)]"
              maxLength={24}
              minLength={3}
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
              pattern="[a-z0-9_]+"
              placeholder="username"
              required
              value={username}
            />
          )}
          <input
            autoComplete={register ? 'new-password' : 'current-password'}
            className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 outline-none focus:ring-2 focus:ring-[var(--accent)]"
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Пароль"
            required
            type="password"
            value={password}
          />
          {register && (
            <input
              autoComplete="new-password"
              className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 outline-none focus:ring-2 focus:ring-[var(--accent)]"
              minLength={8}
              onChange={(event) => setRepeatPassword(event.target.value)}
              placeholder="Повтори пароль"
              required
              type="password"
              value={repeatPassword}
            />
          )}
          {error && (
            <p className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          <button
            className="h-9 rounded-xl bg-[var(--accent)] px-3 font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending}
          >
            {pending ? 'Подожди...' : register ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
        <Link className="mt-4 block text-sm text-[var(--accent)]" to={register ? '/login' : '/register'}>
          {register ? 'Уже есть аккаунт' : 'Создать аккаунт'}
        </Link>
      </section>
    </main>
  );
}

function UserSearchResults({
  users,
  isPending,
  emptyLabel,
  actionLabel,
  disabledUsername,
  onAction,
}: {
  users: PublicUser[];
  isPending: boolean;
  emptyLabel: string;
  actionLabel: string;
  disabledUsername?: string | null;
  onAction: (username: string) => void;
}) {
  if (isPending) {
    return <p className="p-2 text-sm text-[var(--muted)]">Ищем...</p>;
  }

  if (users.length === 0) {
    return <p className="p-2 text-sm text-[var(--muted)]">{emptyLabel}</p>;
  }

  return (
    <>
      {users.map((user) => {
        const username = user.username ?? '';
        const disabled = disabledUsername === username;

        return (
          <div
            className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-white/5"
            key={user.id}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">@{username}</p>
              <p className="truncate text-xs text-[var(--muted)]">{user.name || 'Игрок'}</p>
            </div>
            <button
              className="h-8 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-2 text-xs text-[var(--text)] transition-colors duration-150 hover:bg-[var(--panel)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || !username}
              onClick={() => username && onAction(username)}
              type="button"
            >
              {disabled ? 'Готово' : actionLabel}
            </button>
          </div>
        );
      })}
    </>
  );
}

function ProfileDialog({
  username,
  onClose,
  onSaved,
}: {
  username: string;
  onClose: () => void;
  onSaved: (username: string) => void;
}) {
  const [nextUsername, setNextUsername] = useState(username);
  const mutation = useMutation({
    mutationFn: api.updateProfile,
    onSuccess: ({ user }) => {
      onSaved(user.username ?? nextUsername.trim().toLowerCase());
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(nextUsername.trim().toLowerCase());
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Профиль</h2>
            <p className="text-sm text-[var(--muted)]">Пока только ник, без лишнего шума.</p>
          </div>
          <button className="text-sm text-[var(--muted)] hover:text-[var(--text)]" onClick={onClose} type="button">
            Закрыть
          </button>
        </div>

        <form className="grid gap-3" onSubmit={submit}>
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Ник</span>
            <input
              className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 outline-none focus:ring-2 focus:ring-[var(--accent)]"
              maxLength={24}
              minLength={3}
              onChange={(event) => setNextUsername(event.target.value.toLowerCase())}
              pattern="[a-z0-9_]+"
              required
              value={nextUsername}
            />
          </label>
          {mutation.error && <p className="text-sm text-[var(--danger)]">{errorMessage(mutation.error)}</p>}
          <button
            className="h-9 rounded-xl bg-[var(--accent)] px-3 font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:opacity-50"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Сохраняю...' : 'Сохранить ник'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ChatSidebar({
  chats,
  currentUser,
  selectedChatId,
  socket,
  onOpenProfile,
  onSelect,
  onSignOut,
}: {
  chats: Chat[];
  currentUser: CurrentUser;
  selectedChatId: string | null;
  socket: ChatSocket | null;
  onOpenProfile: () => void;
  onSelect: (chatId: string) => void;
  onSignOut: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [groupTitle, setGroupTitle] = useState(() => randomRoomTitle());
  const [groupMembers, setGroupMembers] = useState('');
  const normalizedSearch = normalizeUserSearch(search);

  const userSearch = useQuery({
    queryKey: ['users', normalizedSearch],
    queryFn: () => api.searchUsers(normalizedSearch),
    enabled: normalizedSearch.length >= 3,
  });

  const directMutation = useMutation({
    mutationFn: api.createDirectChat,
    onSuccess: ({ chat }) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      onSelect(chat.id);
      setSearch('');
    },
  });

  const groupMutation = useMutation({
    mutationFn: ({ title, usernames }: { title: string; usernames: string[] }) =>
      api.createGroupChat(title, usernames),
    onSuccess: ({ chat }) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      onSelect(chat.id);
      setGroupTitle(randomRoomTitle());
      setGroupMembers('');
    },
  });

  function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const usernames = groupMembers
      .split(/[\s,]+/)
      .map((value) => value.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
    const title = groupTitle.trim() || randomRoomTitle();
    groupMutation.mutate({ title, usernames });
  }

  useEffect(() => {
    if (!socket) return;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    };

    const presenceUpdate = (payload: { userId: string; isOnline: boolean }) => {
      queryClient.setQueryData<{ chats: Chat[] }>(['chats'], (old) => {
        if (!old) return old;
        return {
          chats: old.chats.map((chat) => {
            const memberIds = new Set(chat.members.map((member) => member.user.id));
            if (!memberIds.has(payload.userId)) return chat;
            const nextOnline = new Set(chat.onlineMemberIds ?? []);
            if (payload.isOnline) nextOnline.add(payload.userId);
            else nextOnline.delete(payload.userId);
            return { ...chat, onlineMemberIds: [...nextOnline] };
          }),
        };
      });
    };

    socket.on('chat:list:invalidate', invalidate);
    socket.on('presence:update', presenceUpdate);

    return () => {
      socket.off('chat:list:invalidate', invalidate);
      socket.off('presence:update', presenceUpdate);
    };
  }, [queryClient, socket]);

  return (
    <aside className="flex min-h-screen flex-col border-r border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted)]">Чаты</p>
          <p className="text-xs text-[var(--muted)]">Личные и общие в одном списке</p>
        </div>
        <button className="text-xs text-[var(--muted)] hover:text-[var(--text)]" onClick={onSignOut} type="button">
          Выйти
        </button>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--muted)]">Поиск @username</p>
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
            чат
          </span>
        </div>
        <input
          className="h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 outline-none focus:ring-2 focus:ring-[var(--accent)]"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Напиши ник"
          value={search}
        />
        {normalizedSearch.length >= 3 && (
          <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2">
            <UserSearchResults
              actionLabel="Создать"
              disabledUsername={null}
              emptyLabel="Никого не нашёл"
              isPending={userSearch.isPending}
              onAction={(username) => directMutation.mutate(username)}
              users={userSearch.data?.users ?? []}
            />
            {directMutation.error && (
              <p className="p-2 text-xs text-[var(--danger)]">{errorMessage(directMutation.error)}</p>
            )}
          </div>
        )}
      </div>

      <form className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3" onSubmit={createGroup}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--muted)]">Новая комната</p>
          <button
            className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)]"
            onClick={() => setGroupTitle(randomRoomTitle())}
            type="button"
          >
            рандом
          </button>
        </div>
        <input
          className="mb-2 h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
          onChange={(event) => setGroupTitle(event.target.value)}
          placeholder="Название комнаты"
          value={groupTitle}
        />
        <input
          className="mb-2 h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
          onChange={(event) => setGroupMembers(event.target.value)}
          placeholder="@user1, @user2"
          value={groupMembers}
        />
        <button
          className="h-9 w-full rounded-xl bg-[var(--accent)] px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:opacity-50"
          disabled={groupMutation.isPending}
        >
          {groupMutation.isPending ? 'Создаю...' : 'Создать комнату'}
        </button>
        {groupMutation.error && (
          <p className="mt-2 text-xs text-[var(--danger)]">{errorMessage(groupMutation.error)}</p>
        )}
      </form>

      <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
        {chats.length === 0 && <p className="mt-8 text-sm text-[var(--muted)]">Пока пусто</p>}
        {chats.map((chat) => {
          const active = chat.id === selectedChatId;
          const members = chat.members
            .filter((member) => member.user.id !== currentUser.id)
            .map((member) => `@${member.user.username}`)
            .join(', ');
          const lastTime = formatChatTime(chat.lastMessage?.createdAt);
          const unread = chat.unreadCount ?? 0;
          const onlineCount =
            chat.onlineMemberIds?.filter((memberId) =>
              chat.members.some((member) => member.user.id === memberId),
            ).length ?? 0;

          return (
            <button
              className={`mb-2 w-full rounded-xl border px-3 py-3 text-left transition-colors duration-150 ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] bg-[var(--panel-2)] hover:bg-[var(--panel)]'
              }`}
              key={chat.id}
              onClick={() => onSelect(chat.id)}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="truncate font-medium">{chat.displayTitle ?? chat.title ?? 'Чат'}</p>
                <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                  {onlineCount > 0 && <span>{onlineCount} online</span>}
                  {lastTime && <span>{lastTime}</span>}
                  {unread > 0 && <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-white">{unread}</span>}
                </div>
              </div>
              <p className="truncate text-xs text-[var(--muted)]">
                {chat.lastMessage?.text ?? (members || 'Пусто')}
              </p>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
        <p className="text-sm text-[var(--muted)]">Профиль</p>
        <button
          className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-[var(--panel)]"
          onClick={onOpenProfile}
          type="button"
        >
          @{currentUser.username ?? currentUser.name}
        </button>
      </div>
    </aside>
  );
}

function GroupMemberManager({
  chat,
  onClose,
  onAdded,
  onRename,
  onLeave,
}: {
  chat: Chat;
  onClose: () => void;
  onAdded: () => void;
  onRename: (title: string) => void;
  onLeave: () => void;
}) {
  const existingUserIds = new Set(chat.members.map((member) => member.user.id));
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState(chat.title ?? '');
  const normalizedSearch = normalizeUserSearch(search);
  const userSearch = useQuery({
    queryKey: ['group-users', chat.id, normalizedSearch],
    queryFn: () => api.searchUsers(normalizedSearch),
    enabled: normalizedSearch.length >= 3,
  });
  const addMemberMutation = useMutation({
    mutationFn: (username: string) => api.addChatMember(chat.id, username),
    onSuccess: () => {
      setSearch('');
      onAdded();
    },
  });

  const availableUsers = (userSearch.data?.users ?? []).filter((user) => !existingUserIds.has(user.id));

  useEffect(() => {
    setTitle(chat.title ?? '');
  }, [chat.title]);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="mb-3 grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--text)]">Комната</p>
          <button className="text-xs text-[var(--danger)] hover:brightness-110" onClick={onLeave} type="button">
            Выйти
          </button>
        </div>
        <div className="flex gap-2">
          <input
            className="h-9 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Переименовать комнату"
            value={title}
          />
          <button
            className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm transition-colors duration-150 hover:bg-[var(--panel)]"
            onClick={() => onRename(title.trim())}
            type="button"
          >
            Сохранить
          </button>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--text)]">Добавить людей</p>
        <p className="text-xs text-[var(--muted)]">Поиск и приглашение сразу</p>
      </div>
      <input
        className="h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Поиск @username"
        value={search}
      />
      {normalizedSearch.length >= 3 && (
        <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2">
          <UserSearchResults
            actionLabel="Добавить"
            disabledUsername={null}
            emptyLabel="Некого добавить"
            isPending={userSearch.isPending}
            onAction={(username) => addMemberMutation.mutate(username)}
            users={availableUsers}
          />
          {addMemberMutation.error && (
            <p className="p-2 text-xs text-[var(--danger)]">{errorMessage(addMemberMutation.error)}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ChatView({
  chat,
  currentUserId,
  socket,
  onBack,
  onOpenSidebar,
  onChatChanged,
}: {
  chat: Chat;
  currentUserId: string;
  socket: ChatSocket | null;
  onBack: () => void;
  onOpenSidebar: () => void;
  onChatChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [roomPanelOpen, setRoomPanelOpen] = useState(false);
  const messagesQuery = useInfiniteQuery({
    queryKey: ['messages', chat.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getMessages(chat.id, pageParam ?? undefined),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setError(null);

    if (socket?.connected) {
      socket.emit('message:send', { chatId: chat.id, text: value }, (response) => {
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setText('');
      });
      return;
    }

    try {
      const { message } = await api.sendMessage(chat.id, value);
      queryClient.setQueryData<MessagesInfinite>(['messages', chat.id], (old) =>
        appendMessageToPages(old, message),
      );
      queryClient.setQueryData<ChatListData>(['chats'], (old) =>
        patchChatsWithMessage(old, message, currentUserId, chat.id),
      );
      setText('');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  useEffect(() => {
    if (!socket) return;

    const handleTyping = (payload: { chatId: string; users: PublicUser[] }) => {
      if (payload.chatId !== chat.id) return;
      setTypingUserIds(payload.users.map((user) => user.id));
    };

    socket.on('typing:update', handleTyping);

    return () => {
      socket.off('typing:update', handleTyping);
    };
  }, [chat.id, socket]);

  useEffect(() => {
    if (!socket?.connected) return;
    let typingTimer: ReturnType<typeof setTimeout> | null = null;

    if (text.trim().length > 0) {
      socket.emit('typing:start', { chatId: chat.id });
      typingTimer = setTimeout(() => {
        socket.emit('typing:stop', { chatId: chat.id });
      }, 800);
    } else {
      socket.emit('typing:stop', { chatId: chat.id });
    }

    return () => {
      if (typingTimer) clearTimeout(typingTimer);
      socket.emit('typing:stop', { chatId: chat.id });
    };
  }, [chat.id, socket, text]);

  useEffect(() => {
    if (!messagesQuery.data) return;
    void api.markChatRead(chat.id);
    queryClient.invalidateQueries({ queryKey: ['chats'] });
  }, [chat.id, messagesQuery.data, queryClient]);

  useEffect(() => {
    setRoomPanelOpen(false);
  }, [chat.id]);

  const messages =
    messagesQuery.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => page.messages) ?? [];
  const nextCursor = messagesQuery.data?.pages[messagesQuery.data.pages.length - 1]?.nextCursor ?? null;
  const typingUsers = chat.members
    .map((member) => member.user)
    .filter((user) => typingUserIds.includes(user.id) && user.id !== currentUserId)
    .map((user) => `@${user.username ?? user.name}`);

  return (
    <section className="flex min-h-screen flex-col bg-[var(--bg)]">
      <header className="flex min-h-[72px] shrink-0 items-center justify-between border-b border-[var(--border)] px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--text)] md:hidden"
            onClick={onOpenSidebar}
            type="button"
          >
            Чаты
          </button>
          <div>
            <p className="truncate font-medium">{chat.displayTitle ?? chat.title ?? 'Чат'}</p>
            <p className="text-xs text-[var(--muted)]">{chat.members.length} участник(ов)</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {chat.type === 'group' && (
            <button
              className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--panel-2)]"
              onClick={() => setRoomPanelOpen((value) => !value)}
              type="button"
            >
              {roomPanelOpen ? 'Скрыть комнату' : 'Пригласить / имя'}
            </button>
          )}
          <button
            className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--text)] md:hidden"
            onClick={onBack}
            type="button"
          >
            Назад
          </button>
        </div>
      </header>

      <Suspense
        fallback={
          <div className="border-b border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
            Голос...
          </div>
        }
      >
        <VoicePanel chat={chat} socket={socket} />
      </Suspense>

      {chat.type === 'group' && roomPanelOpen && (
        <div className="border-b border-[var(--border)] px-4 py-3">
          <GroupMemberManager
            chat={chat}
            onClose={() => setRoomPanelOpen(false)}
            onAdded={onChatChanged}
            onLeave={async () => {
              await api.leaveGroupChat(chat.id);
              queryClient.invalidateQueries({ queryKey: ['chats'] });
              onBack();
            }}
            onRename={async (title) => {
              if (!title) return;
              await api.renameChat(chat.id, title);
              queryClient.invalidateQueries({ queryKey: ['chats'] });
            }}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {messagesQuery.isPending && <p className="text-sm text-[var(--muted)]">Гружу сообщения...</p>}
        {messages.length === 0 && !messagesQuery.isPending && (
          <p className="text-center text-sm text-[var(--muted)]">Пока пусто. Напиши первым.</p>
        )}
        {nextCursor && (
          <div className="mb-3 flex justify-center">
            <button
              className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 text-xs text-[var(--text)]"
              onClick={() => messagesQuery.fetchNextPage()}
              type="button"
            >
              Показать старые
            </button>
          </div>
        )}
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
          {messages.map((message) => {
            const own = message.userId === currentUserId;

            return (
              <div className="px-4 py-3" key={message.id}>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className={`text-sm font-medium ${own ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
                      {own ? 'Ты' : `@${message.user.username}`}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {formatChatTime(message.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text)]">
                  {message.text}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--panel)] p-3">
        {error && <p className="mb-2 text-sm text-[var(--danger)]">{error}</p>}
        {typingUsers.length > 0 && (
          <p className="mb-2 text-xs text-[var(--muted)]">{typingUsers.join(', ')} печатает...</p>
        )}
        <form className="flex gap-2" onSubmit={send}>
          <input
            className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 outline-none focus:ring-2 focus:ring-[var(--accent)]"
            maxLength={4000}
            onChange={(event) => setText(event.target.value)}
            placeholder="Написать сообщение..."
            value={text}
          />
          <button className="h-10 rounded-xl bg-[var(--accent)] px-4 font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)]">
            Отправить
          </button>
        </form>
      </footer>
    </section>
  );
}

function ChatLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = authClient.useSession();
  const baseUser = data?.user as CurrentUser | undefined;
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [socketGeneration, setSocketGeneration] = useState(0);
  const [localUsername, setLocalUsername] = useState<string | null>(baseUser?.username ?? null);
  const selectedChatIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(baseUser?.id ?? null);
  const chatsQuery = useQuery({ queryKey: ['chats'], queryFn: api.listChats });
  const chats = chatsQuery.data?.chats ?? [];
  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? null,
    [chats, selectedChatId],
  );

  useEffect(() => {
    setLocalUsername(baseUser?.username ?? null);
    currentUserIdRef.current = baseUser?.id ?? null;
  }, [baseUser?.id, baseUser?.username]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    if (selectedChatId) setSidebarOpen(false);
    else setSidebarOpen(true);
  }, [selectedChatId]);

  useEffect(() => {
    if (!selectedChatId && chats[0]) {
      setSelectedChatId(chats[0].id);
      return;
    }

    if (selectedChatId && !chats.some((chat) => chat.id === selectedChatId)) {
      setSelectedChatId(chats[0]?.id ?? null);
    }
  }, [chats, selectedChatId]);

  useEffect(() => {
    const nextSocket = createChatSocket();
    setSocket(nextSocket);

    nextSocket.on('message:new', (message) => {
      queryClient.setQueryData<MessagesInfinite>(['messages', message.chatId], (old) =>
        appendMessageToPages(old, message),
      );
      queryClient.setQueryData<ChatListData>(['chats'], (old) =>
        patchChatsWithMessage(old, message, currentUserIdRef.current, selectedChatIdRef.current),
      );
    });

    nextSocket.on('chat:updated', (chat) => {
      queryClient.setQueryData<ChatListData>(['chats'], (old) => upsertChat(old, chat));
    });

    nextSocket.on('chat:list:invalidate', () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    });

    nextSocket.on('message:error', (payload) => {
      console.warn(payload.message);
    });

    return () => {
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [queryClient, socketGeneration]);

  useEffect(() => {
    if (!socket || !selectedChatId) return;
    socket.emit('chat:join', { chatId: selectedChatId });
    return () => {
      socket.emit('chat:leave', { chatId: selectedChatId });
    };
  }, [selectedChatId, socket]);

  async function signOut() {
    await authClient.signOut();
    navigate('/login', { replace: true });
  }

  function handleProfileSaved(username: string) {
    setLocalUsername(username);
    setProfileOpen(false);
    setSocketGeneration((value) => value + 1);
    queryClient.invalidateQueries({ queryKey: ['chats'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  if (!baseUser) return <LoadingScreen />;

  const currentUser: CurrentUser = {
    ...baseUser,
    username: localUsername ?? baseUser.username ?? baseUser.name,
  };

  return (
    <>
      <main className="grid min-h-screen grid-cols-1 bg-[var(--bg)] md:grid-cols-[320px_1fr]">
        <div className="hidden md:block">
          <ChatSidebar
            chats={chats}
            currentUser={currentUser}
            onOpenProfile={() => setProfileOpen(true)}
            onSelect={setSelectedChatId}
            onSignOut={signOut}
            socket={socket}
            selectedChatId={selectedChatId}
          />
        </div>

        <div className="min-w-0">
          {selectedChat ? (
            <ChatView
              chat={selectedChat}
              currentUserId={currentUser.id}
              onBack={() => setSelectedChatId(null)}
              onOpenSidebar={() => setSidebarOpen(true)}
              onChatChanged={() => queryClient.invalidateQueries({ queryKey: ['chats'] })}
              socket={socket}
            />
          ) : (
            <section className="grid min-h-screen place-items-center px-4 text-center">
              <div className="grid gap-3">
                <p className="text-sm text-[var(--muted)]">Выбери чат или создай новый.</p>
                <button
                  className="h-10 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 text-sm text-[var(--text)] md:hidden"
                  onClick={() => setSidebarOpen(true)}
                  type="button"
                >
                  Открыть список чатов
                </button>
              </div>
            </section>
          )}
        </div>
      </main>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Закрыть список чатов"
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
            type="button"
          />
          <div className="absolute inset-y-0 left-0 w-[min(88vw,320px)]">
            <ChatSidebar
              chats={chats}
              currentUser={currentUser}
              onOpenProfile={() => setProfileOpen(true)}
              onSelect={setSelectedChatId}
              onSignOut={signOut}
              socket={socket}
              selectedChatId={selectedChatId}
            />
          </div>
        </div>
      )}

      {profileOpen && (
        <ProfileDialog
          onClose={() => setProfileOpen(false)}
          onSaved={handleProfileSaved}
          username={currentUser.username ?? currentUser.name}
        />
      )}
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        element={
          <PublicOnly>
            <AuthCard mode="login" />
          </PublicOnly>
        }
        path="/login"
      />
      <Route
        element={
          <PublicOnly>
            <AuthCard mode="register" />
          </PublicOnly>
        }
        path="/register"
      />
      <Route
        element={
          <ProtectedRoute>
            <ChatLayout />
          </ProtectedRoute>
        }
        path="/app"
      />
      <Route element={<Navigate to="/app" replace />} path="*" />
    </Routes>
  );
}
