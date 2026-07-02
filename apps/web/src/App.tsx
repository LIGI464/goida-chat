import { LiveKitRoom } from '@livekit/components-react';
import { signInSchema, signUpSchema } from '@goida-chat/shared';
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Suspense,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { GoidaLogo } from './components/brand/GoidaLogo';
import { ChatActionsMenu, type ChatActionItem } from './components/chat/ChatActionsMenu';
import { ConnectedVoiceRuntime, VoicePanel } from './components/voice/VoicePanel';
import {
  buildAudioCaptureOptions,
  readVoiceCapturePreferences,
  writeVoiceCapturePreferences,
  type NoiseSuppressionMode,
  type VoiceCapturePreferences,
} from './features/voice/audio/audioConstraints';
import { useAudioDevices } from './features/voice/audio/useAudioDevices';
import type { NoiseSuppressionRuntimeState } from './features/voice/audio/useNoiseSuppression';
import { usePersistentPeerVolumes } from './features/voice/audio/usePersistentPeerVolumes';
import { api, type Chat, type Message, type PublicUser, type VoiceToken } from './lib/api';
import { authClient } from './lib/auth-client';
import { createChatSocket, type ChatSocket } from './lib/socket';

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
type MessagesInfinite = InfiniteData<MessagesPage, string | null>;
type ChatListData = { chats: Chat[] };
type CurrentUser = { id: string; name: string; username?: string | null };
type VoiceDisconnectAction = 'leave' | 'removed' | 'switch';

const brandInputClassName = 'brand-input h-11 px-4 text-sm';
const brandInputCompactClassName = 'brand-input h-10 px-3.5 text-sm';
const brandPrimaryButtonClassName =
  'brand-button brand-button-primary h-11 px-4 text-sm disabled:opacity-55';
const brandPrimaryButtonCompactClassName =
  'brand-button brand-button-primary h-10 px-4 text-sm disabled:opacity-55';
const brandSecondaryButtonClassName =
  'brand-button brand-button-secondary h-11 px-4 text-sm disabled:opacity-55';
const brandSecondaryButtonCompactClassName =
  'brand-button brand-button-secondary h-10 px-3.5 text-sm disabled:opacity-55';
const brandGhostButtonClassName =
  'brand-button brand-button-ghost h-9 px-2.5 text-sm disabled:opacity-55';
const brandDangerNoticeClassName =
  'rounded-2xl border border-[rgba(255,117,130,0.22)] bg-[rgba(84,15,28,0.34)] px-4 py-3 text-sm text-[#ffd8dd]';
const brandSuccessNoticeClassName =
  'rounded-2xl border border-[rgba(124,226,188,0.2)] bg-[rgba(14,58,44,0.34)] px-4 py-3 text-sm text-[#c8f7e3]';

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

function profileUsernameError(value: string) {
  const normalized = normalizeUserSearch(value);

  if (!normalized) {
    return 'Ник не может быть пустым.';
  }

  if (normalized.length < 3) {
    return 'Ник должен быть не короче 3 символов.';
  }

  if (normalized.length > 24) {
    return 'Ник должен быть не длиннее 24 символов.';
  }

  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return 'Используй только строчные латинские буквы, цифры и _.';
  }

  return null;
}

function groupTitleError(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return 'Название комнаты не может быть пустым.';
  }

  if (normalized.length > 100) {
    return 'Название комнаты должно быть не длиннее 100 символов.';
  }

  return null;
}

function formatChatTime(value?: string | null) {
  if (!value) return '';

  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <section className="brand-card w-full max-w-sm px-6 py-7 text-center">
        <GoidaLogo
          className="mx-auto mb-5 block w-20"
          imageClassName="h-auto w-full object-contain"
          variant="mark"
        />
        <p className="brand-display text-lg text-[var(--text)]">Goida Chat</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Поднимаем брендированное рабочее пространство…
        </p>
      </section>
    </main>
  );
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

function removeChat(data: ChatListData | undefined, chatId: string): ChatListData | undefined {
  if (!data) return data;
  return { chats: data.chats.filter((chat) => chat.id !== chatId) };
}

function clearChatClientState(queryClient: QueryClient, chatId: string) {
  queryClient.setQueryData<ChatListData>(['chats'], (old) => removeChat(old, chatId));
  queryClient.removeQueries({ queryKey: ['messages', chatId] });
  queryClient.removeQueries({ queryKey: ['voicePresence', chatId] });
}

function canDeleteChat(chat: Chat, currentUserId: string) {
  return chat.type === 'group' && chat.createdById === currentUserId;
}

function unavailableDirectChatAction(): ChatActionItem {
  return {
    label: 'Личный чат нельзя удалить для всех',
    disabled: true,
    onSelect: () => {},
  };
}

function buildGroupChatActionItems({
  allowDelete,
  disabled,
  onDelete,
  onLeave,
  onManage,
}: {
  allowDelete: boolean;
  disabled: boolean;
  onDelete: () => void;
  onLeave: () => void;
  onManage: () => void;
}): ChatActionItem[] {
  return [
    {
      label: 'Пригласить или переименовать',
      disabled,
      onSelect: onManage,
    },
    {
      label: 'Выйти из комнаты',
      disabled,
      onSelect: () => {
        if (!window.confirm('Выйти из этой комнаты?')) {
          return;
        }

        onLeave();
      },
    },
    {
      label: 'Удалить чат',
      disabled,
      hidden: !allowDelete,
      tone: 'danger',
      onSelect: () => {
        if (
          !window.confirm(
            'Удалить чат для всех участников? Сообщения и голосовая комната тоже исчезнут.',
          )
        ) {
          return;
        }

        onDelete();
      },
    },
  ];
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
    message.userId === currentUserId || current.id === selectedChatId
      ? 0
      : (current.unreadCount ?? 0) + 1;
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

function patchChatsWithUser(
  data: ChatListData | undefined,
  user: PublicUser,
  currentUserId: string | null,
): ChatListData | undefined {
  if (!data) return data;

  return {
    chats: data.chats.map((chat) => {
      const members = chat.members.map((member) =>
        member.user.id === user.id ? { ...member, user: { ...member.user, ...user } } : member,
      );
      const lastMessage =
        chat.lastMessage?.user.id === user.id
          ? { ...chat.lastMessage, user: { ...chat.lastMessage.user, ...user } }
          : chat.lastMessage;
      const directPeer =
        chat.type === 'direct'
          ? members.find((member) => member.user.id !== currentUserId)?.user
          : null;

      return {
        ...chat,
        members,
        lastMessage,
        displayTitle:
          chat.type === 'direct'
            ? `@${directPeer?.username ?? directPeer?.name ?? 'unknown'}`
            : (chat.displayTitle ?? chat.title ?? null),
      };
    }),
  };
}

function patchMessagesWithUser(
  data: MessagesInfinite | undefined,
  user: PublicUser,
): MessagesInfinite | undefined {
  if (!data) return data;

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: page.messages.map((message) =>
        message.user.id === user.id ? { ...message, user: { ...message.user, ...user } } : message,
      ),
    })),
  };
}

function patchUsersArray(users: PublicUser[] | undefined, user: PublicUser) {
  if (!users) return users;
  return users.map((item) => (item.id === user.id ? { ...item, ...user } : item));
}

function patchUserCaches(queryClient: QueryClient, user: PublicUser, currentUserId: string | null) {
  queryClient.setQueryData<ChatListData>(['chats'], (old) =>
    patchChatsWithUser(old, user, currentUserId),
  );

  for (const [queryKey] of queryClient.getQueriesData<MessagesInfinite>({
    queryKey: ['messages'],
  })) {
    queryClient.setQueryData<MessagesInfinite>(queryKey, (old) => patchMessagesWithUser(old, user));
  }

  for (const [queryKey] of queryClient.getQueriesData<{ users: PublicUser[] }>({
    queryKey: ['voicePresence'],
  })) {
    queryClient.setQueryData<{ users: PublicUser[] }>(queryKey, (old) =>
      old ? { users: patchUsersArray(old.users, user) ?? [] } : old,
    );
  }
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  if (isPending) return <LoadingScreen />;
  if (data) return <Navigate replace to="/app" />;
  return children;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, isPending } = authClient.useSession();
  if (isPending) return <LoadingScreen />;
  if (!data) return <Navigate replace state={{ from: location.pathname }} to="/login" />;
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
        setError(caught.issues[0]?.message ?? 'Check the form fields.');
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
      <section className="brand-card relative mx-auto grid w-full max-w-6xl overflow-hidden lg:grid-cols-[1.05fr_0.95fr]">
        <div className="relative hidden min-h-[620px] overflow-hidden border-r brand-divider px-8 py-10 lg:flex lg:flex-col lg:justify-between xl:px-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.09),transparent_28%),linear-gradient(140deg,rgba(255,255,255,0.03),transparent_42%)]" />
          <div className="relative">
            <div className="brand-pill brand-eyebrow mb-6 text-[11px] text-[var(--muted-strong)]">
              Goida Chat
            </div>
            <GoidaLogo
              className="block max-w-[430px]"
              imageClassName="h-auto w-full object-contain"
              variant="lockup"
            />
            <h1 className="brand-display mt-10 max-w-lg text-4xl leading-[1.05] font-semibold text-[var(--text)] xl:text-5xl">
              Private chats, rooms, and voice sessions without extra noise.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted-strong)]">
              Messages, quick rooms, and voice in one calm workspace.
            </p>
          </div>

          <div className="relative grid gap-3 xl:max-w-[480px]">
            <div className="brand-surface px-5 py-4">
              <p className="brand-display text-sm font-semibold text-[var(--text)]">
                Everything in one place
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Jump back into your rooms, messages, and voice sessions without extra steps.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-[var(--muted-strong)]">
              <span className="brand-pill">Private rooms</span>
              <span className="brand-pill">Voice sessions</span>
              <span className="brand-pill">Keep it simple</span>
            </div>
          </div>
        </div>

        <div className="relative px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center">
            <div className="mb-8 lg:hidden">
              <GoidaLogo
                className="block max-w-[270px]"
                imageClassName="h-auto w-full object-contain"
                variant="lockup"
              />
            </div>

            <div className="brand-eyebrow mb-3 text-[11px] text-[var(--muted)]">
              {register ? 'Create account' : 'Welcome back'}
            </div>
            <h1 className="brand-display mb-2 text-3xl font-semibold text-[var(--text)]">
              {register ? 'Register' : 'Sign in'}
            </h1>
            <p className="mb-6 text-sm leading-6 text-[var(--muted)]">
              {register
                ? 'Create an account and start chatting in rooms and calls.'
                : 'Return to your chats, rooms, and voice sessions.'}
            </p>

            <form className="grid gap-3" onSubmit={submit}>
              <input
                autoComplete="email"
                className={brandInputClassName}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                required
                type="email"
                value={email}
              />

              {register && (
                <input
                  autoComplete="username"
                  className={brandInputClassName}
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
                className={brandInputClassName}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                required
                type="password"
                value={password}
              />

              {register && (
                <input
                  autoComplete="new-password"
                  className={brandInputClassName}
                  minLength={8}
                  onChange={(event) => setRepeatPassword(event.target.value)}
                  placeholder="Repeat password"
                  required
                  type="password"
                  value={repeatPassword}
                />
              )}

              {error && <p className={brandDangerNoticeClassName}>{error}</p>}

              <button className={brandPrimaryButtonClassName} disabled={pending}>
                {pending ? 'Please wait...' : register ? 'Create account' : 'Sign in'}
              </button>
            </form>

            <Link
              className="brand-link mt-5 inline-flex w-fit text-sm"
              to={register ? '/login' : '/register'}
            >
              {register ? 'Already have an account' : 'Create account'}
            </Link>
          </div>
        </div>
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
  actionDisabled = false,
  onAction,
}: {
  users: PublicUser[];
  isPending: boolean;
  emptyLabel: string;
  actionLabel: string;
  disabledUsername?: string | null;
  actionDisabled?: boolean;
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
        const disabled = actionDisabled || disabledUsername === username;

        return (
          <div
            className="flex items-center justify-between gap-3 rounded-2xl px-2.5 py-2.5 transition-colors duration-150 hover:bg-white/5"
            key={user.id}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">@{username || user.name}</p>
              <p className="truncate text-xs text-[var(--muted)]">{user.name || 'Игрок'}</p>
            </div>
            <button
              className="brand-button brand-button-secondary h-8 rounded-xl px-3 text-xs font-semibold disabled:opacity-55"
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
  onSaved: (user: PublicUser) => void;
}) {
  const [nextUsername, setNextUsername] = useState(username);
  const [validationError, setValidationError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: api.updateProfile,
    onSuccess: ({ user }) => {
      setValidationError(null);
      onSaved(user);
    },
  });
  const normalizedUsername = normalizeUserSearch(nextUsername);
  const currentUsername = normalizeUserSearch(username);

  function handleUsernameChange(value: string) {
    setNextUsername(value.toLowerCase());
    setValidationError(null);
    if (mutation.error) mutation.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextError = profileUsernameError(nextUsername);
    if (nextError) {
      setValidationError(nextError);
      return;
    }

    setValidationError(null);
    mutation.mutate(normalizedUsername);
  }

  return (
    <div className="brand-overlay fixed inset-0 z-50 grid place-items-center p-4">
      <div className="brand-modal w-full max-w-sm p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="brand-eyebrow text-[11px] text-[var(--muted)]">Identity</p>
            <h2 className="brand-display mt-2 text-lg font-semibold text-[var(--text)]">Профиль</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Пока только ник, без лишнего шума.
            </p>
          </div>
          <button className={brandGhostButtonClassName} onClick={onClose} type="button">
            Закрыть
          </button>
        </div>

        <form className="grid gap-3" onSubmit={submit}>
          <label className="grid gap-2">
            <span className="text-sm text-[var(--muted)]">Ник</span>
            <input
              autoComplete="username"
              className={brandInputClassName}
              maxLength={25}
              onChange={(event) => handleUsernameChange(event.target.value)}
              placeholder="@username"
              spellCheck={false}
              value={nextUsername}
            />
          </label>

          {(validationError || mutation.error) && (
            <p className={brandDangerNoticeClassName}>
              {validationError ?? errorMessage(mutation.error)}
            </p>
          )}

          <button
            className={brandPrimaryButtonClassName}
            disabled={mutation.isPending || normalizedUsername === currentUsername}
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
  onOpenGroupManager,
  onOpenProfile,
  onSelect,
  onSignOut,
}: {
  chats: Chat[];
  currentUser: CurrentUser;
  selectedChatId: string | null;
  socket: ChatSocket | null;
  onOpenGroupManager: (chatId: string) => void;
  onOpenProfile: () => void;
  onSelect: (chatId: string | null) => void;
  onSignOut: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [groupTitle, setGroupTitle] = useState(() => randomRoomTitle());
  const [groupMembers, setGroupMembers] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
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

  const deleteChatMutation = useMutation({
    mutationFn: api.deleteChat,
    onSuccess: (_, chatId) => {
      clearChatClientState(queryClient, chatId);
      setActionError(null);
      if (selectedChatId === chatId) {
        onSelect(null);
      }

      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: (caught) => {
      setActionError(errorMessage(caught));
    },
  });

  const leaveChatMutation = useMutation({
    mutationFn: api.leaveGroupChat,
    onSuccess: (_, chatId) => {
      clearChatClientState(queryClient, chatId);
      setActionError(null);
      if (selectedChatId === chatId) {
        onSelect(null);
      }

      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: (caught) => {
      setActionError(errorMessage(caught));
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
      queryClient.setQueryData<ChatListData>(['chats'], (old) => {
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
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r brand-divider bg-[linear-gradient(180deg,rgba(14,15,18,0.98),rgba(8,9,11,0.98))] p-4">
      <div className="mb-4 brand-card px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <GoidaLogo
              className="block max-w-[260px]"
              imageClassName="h-auto w-full object-contain"
              variant="lockup"
            />
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              Private chats, rooms, and voice sessions in one tidy space.
            </p>
          </div>
          <button className={brandGhostButtonClassName} onClick={onSignOut} type="button">
            Sign out
          </button>
        </div>
      </div>

      <div className="brand-surface shrink-0 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="brand-eyebrow text-[10px] text-[var(--muted)]">Search</p>
            <p className="mt-1 text-sm text-[var(--muted-strong)]">Поиск @username</p>
          </div>
          <span className="brand-pill text-[10px]">чат</span>
        </div>

        <input
          className={brandInputCompactClassName}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Напиши ник"
          value={search}
        />

        {normalizedSearch.length >= 3 && (
          <div className="brand-surface-muted app-scrollbar mt-3 max-h-48 overflow-y-auto overflow-x-hidden p-2">
            <UserSearchResults
              actionLabel="Создать"
              disabledUsername={null}
              emptyLabel="Никого не нашёл"
              isPending={userSearch.isPending}
              onAction={(username) => directMutation.mutate(username)}
              users={userSearch.data?.users ?? []}
            />
            {directMutation.error && (
              <p className="p-2 text-xs text-[var(--danger)]">
                {errorMessage(directMutation.error)}
              </p>
            )}
          </div>
        )}
      </div>

      <form className="brand-surface mt-3 shrink-0 p-3" onSubmit={createGroup}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="brand-eyebrow text-[10px] text-[var(--muted)]">Create room</p>
            <p className="mt-1 text-sm text-[var(--muted-strong)]">Новая комната</p>
          </div>
          <button
            className="brand-link text-xs"
            onClick={() => setGroupTitle(randomRoomTitle())}
            type="button"
          >
            Random
          </button>
        </div>

        <input
          className={`${brandInputCompactClassName} mb-2`}
          onChange={(event) => setGroupTitle(event.target.value)}
          placeholder="Название комнаты"
          value={groupTitle}
        />
        <input
          className={`${brandInputCompactClassName} mb-3`}
          onChange={(event) => setGroupMembers(event.target.value)}
          placeholder="@user1, @user2"
          value={groupMembers}
        />

        <button
          className={`${brandPrimaryButtonCompactClassName} w-full`}
          disabled={groupMutation.isPending}
        >
          {groupMutation.isPending ? 'Создаю...' : 'Создать комнату'}
        </button>

        {groupMutation.error && (
          <p className="mt-2 text-xs text-[var(--danger)]">{errorMessage(groupMutation.error)}</p>
        )}
      </form>

      <div className="app-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pr-1">
        {actionError && <p className={`mb-3 ${brandDangerNoticeClassName}`}>{actionError}</p>}
        {chats.length === 0 && (
          <div className="brand-surface mt-6 grid place-items-center px-4 py-6 text-center">
            <GoidaLogo
              className="mb-4 block w-16"
              imageClassName="h-auto w-full object-contain opacity-90"
              variant="mark"
            />
            <p className="text-sm text-[var(--muted)]">
              Пока пусто. Создай первый чат или комнату.
            </p>
          </div>
        )}

        {chats.map((chat) => {
          const active = chat.id === selectedChatId;
          const allowDelete = canDeleteChat(chat, currentUser.id);
          const actionPending = leaveChatMutation.isPending || deleteChatMutation.isPending;
          const actionItems =
            chat.type === 'group'
              ? buildGroupChatActionItems({
                  allowDelete,
                  disabled: actionPending,
                  onDelete: () => {
                    setActionError(null);
                    deleteChatMutation.mutate(chat.id);
                  },
                  onLeave: () => {
                    setActionError(null);
                    leaveChatMutation.mutate(chat.id);
                  },
                  onManage: () => {
                    setActionError(null);
                    onOpenGroupManager(chat.id);
                  },
                })
              : [unavailableDirectChatAction()];
          const members = chat.members
            .filter((member) => member.user.id !== currentUser.id)
            .map((member) => `@${member.user.username ?? member.user.name}`)
            .join(', ');
          const lastTime = formatChatTime(chat.lastMessage?.createdAt);
          const unread = chat.unreadCount ?? 0;
          const onlineCount =
            chat.onlineMemberIds?.filter((memberId) =>
              chat.members.some((member) => member.user.id === memberId),
            ).length ?? 0;

          return (
            <div
              className={`group mb-2 flex items-start gap-2 rounded-[1.35rem] border p-2 transition-colors duration-150 ${
                active
                  ? 'border-[var(--halo-strong)] bg-white/[0.06] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_0_26px_rgba(255,255,255,0.08)]'
                  : 'border-[var(--border)] bg-[linear-gradient(180deg,rgba(24,26,30,0.98),rgba(15,16,19,0.98))] hover:border-[var(--border-strong)] hover:bg-[linear-gradient(180deg,rgba(28,30,35,1),rgba(18,19,22,1))]'
              }`}
              key={chat.id}
            >
              <button
                className="min-w-0 flex-1 rounded-xl px-2 py-1.5 text-left"
                onClick={() => onSelect(chat.id)}
                type="button"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p
                    className={`truncate text-sm font-semibold ${active ? 'text-[var(--text)]' : 'text-[var(--text-soft)]'}`}
                  >
                    {chat.displayTitle ?? chat.title ?? 'Чат'}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                    {onlineCount > 0 && <span>{onlineCount} online</span>}
                    {lastTime && <span>{lastTime}</span>}
                    {unread > 0 && (
                      <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[var(--accent-contrast)]">
                        {unread}
                      </span>
                    )}
                  </div>
                </div>
                <p className="truncate text-xs text-[var(--muted)]">
                  {chat.lastMessage?.text ?? (members || 'Пусто')}
                </p>
              </button>

              <div className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                <ChatActionsMenu
                  buttonClassName="h-8 w-8 rounded-xl border-0 bg-transparent shadow-none"
                  items={actionItems}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="brand-surface mt-3 shrink-0 p-3">
        <p className="brand-eyebrow text-[10px] text-[var(--muted)]">Profile</p>
        <button
          className="brand-surface-muted mt-2 w-full px-3 py-3 text-left transition-colors duration-150 hover:border-[var(--border-strong)]"
          onClick={onOpenProfile}
          type="button"
        >
          <span className="block text-sm font-semibold text-[var(--text)]">
            @{currentUser.username ?? currentUser.name}
          </span>
          <span className="mt-1 block text-xs text-[var(--muted)]">
            Настройки идентичности и никнейма
          </span>
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
}: {
  chat: Chat;
  onClose: () => void;
  onAdded: () => void;
  onRename: (title: string) => Promise<void>;
}) {
  const existingUserIds = new Set(chat.members.map((member) => member.user.id));
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState(chat.title ?? '');
  const [renamePending, setRenamePending] = useState(false);
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

  const availableUsers = (userSearch.data?.users ?? []).filter(
    (user) => !existingUserIds.has(user.id),
  );

  useEffect(() => {
    setTitle(chat.title ?? '');
  }, [chat.title]);

  async function submitRename() {
    const nextTitle = title.trim();
    if (!nextTitle) return;

    try {
      setRenamePending(true);
      await onRename(nextTitle);
    } finally {
      setRenamePending(false);
    }
  }

  return (
    <div className="brand-card rounded-3xl p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-[var(--text)]">Настройки комнаты</p>
          <p className="text-sm text-[var(--muted)]">
            Переименование и приглашения без перезагрузки.
          </p>
        </div>
        <button className={brandGhostButtonClassName} onClick={onClose} type="button">
          Закрыть
        </button>
      </div>

      <div className="brand-surface mb-4 grid gap-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--text)]">Название комнаты</p>
          <span className="text-xs text-[var(--muted)]">{chat.members.length} участников</span>
        </div>

        <div className="flex flex-col gap-2 md:flex-row">
          <input
            className={`${brandInputCompactClassName} min-w-0 flex-1`}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Переименовать комнату"
            value={title}
          />
          <button
            className={brandSecondaryButtonCompactClassName}
            disabled={renamePending}
            onClick={() => void submitRename()}
            type="button"
          >
            {renamePending ? 'Сохраняю...' : 'Сохранить'}
          </button>
        </div>
      </div>

      <div className="brand-surface mb-4 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--text)]">Сейчас в комнате</p>
          <p className="text-xs text-[var(--muted)]">Участники</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {chat.members.map((member) => (
            <span className="brand-pill text-xs text-[var(--text)]" key={member.id}>
              @{member.user.username ?? member.user.name}
            </span>
          ))}
        </div>
      </div>

      <div className="brand-surface p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--text)]">Пригласить людей</p>
          <p className="text-xs text-[var(--muted)]">Поиск и добавление сразу</p>
        </div>

        <input
          className={brandInputCompactClassName}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск @username"
          value={search}
        />

        {normalizedSearch.length >= 3 && (
          <div className="brand-surface-muted mt-2 p-2">
            <UserSearchResults
              actionLabel="Добавить"
              disabledUsername={null}
              emptyLabel="Некого добавить"
              isPending={userSearch.isPending}
              onAction={(username) => addMemberMutation.mutate(username)}
              users={availableUsers}
            />

            {addMemberMutation.error && (
              <p className="p-2 text-xs text-[var(--danger)]">
                {errorMessage(addMemberMutation.error)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

void GroupMemberManager;

function GroupSettingsModal({
  chat,
  open,
  onClose,
}: {
  chat: Chat;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const existingUserIds = new Set(chat.members.map((member) => member.user.id));
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState(chat.title ?? '');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSuccess, setRenameSuccess] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const normalizedSearch = normalizeUserSearch(search);
  const normalizedTitle = title.trim();

  const userSearch = useQuery({
    queryKey: ['group-users', chat.id, normalizedSearch],
    queryFn: () => api.searchUsers(normalizedSearch),
    enabled: open && normalizedSearch.length >= 3,
  });

  const renameMutation = useMutation({
    mutationFn: (nextTitle: string) => api.renameChat(chat.id, nextTitle),
    onSuccess: ({ chat: updated }) => {
      queryClient.setQueryData<ChatListData>(['chats'], (old) =>
        old ? upsertChat(old, updated) : { chats: [updated] },
      );
      setRenameError(null);
      setRenameSuccess('Название комнаты сохранено.');
    },
    onError: (caught) => {
      setRenameSuccess(null);
      setRenameError(errorMessage(caught));
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: (username: string) => api.addChatMember(chat.id, username),
    onSuccess: ({ chat: updated }, username) => {
      queryClient.setQueryData<ChatListData>(['chats'], (old) =>
        old ? upsertChat(old, updated) : { chats: [updated] },
      );
      queryClient.invalidateQueries({ queryKey: ['voicePresence', chat.id] });
      setSearch('');
      setInviteError(null);
      setInviteSuccess(`@${username} добавлен в комнату.`);
    },
    onError: (caught) => {
      setInviteSuccess(null);
      setInviteError(errorMessage(caught));
    },
  });

  const availableUsers = (userSearch.data?.users ?? []).filter(
    (user) => !existingUserIds.has(user.id),
  );

  useEffect(() => {
    if (!open) return;

    setTitle(chat.title ?? '');
    setSearch('');
    setRenameError(null);
    setRenameSuccess(null);
    setInviteError(null);
    setInviteSuccess(null);
  }, [chat.id, open]);

  useEffect(() => {
    if (!open) return;
    setTitle(chat.title ?? '');
  }, [chat.title, open]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  function handleTitleChange(value: string) {
    setTitle(value);
    setRenameError(null);
    setRenameSuccess(null);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setInviteError(null);
    setInviteSuccess(null);
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextError = groupTitleError(title);
    if (nextError) {
      setRenameSuccess(null);
      setRenameError(nextError);
      return;
    }

    if (normalizedTitle === (chat.title ?? '').trim()) {
      setRenameSuccess(null);
      setRenameError(null);
      return;
    }

    await renameMutation.mutateAsync(normalizedTitle);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Закрыть настройки комнаты"
        className="brand-overlay absolute inset-0"
        onClick={onClose}
        type="button"
      />

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <section
          aria-modal="true"
          className="brand-modal relative flex w-[min(90vw,520px)] min-w-0 flex-col overflow-hidden sm:min-w-[420px]"
          style={{ maxHeight: '85vh' }}
          role="dialog"
        >
          <div className="flex items-start justify-between gap-3 border-b brand-divider px-5 py-4">
            <div className="min-w-0">
              <p className="brand-eyebrow text-[11px] text-[var(--muted)]">Room settings</p>
              <h2 className="brand-display mt-2 truncate text-lg font-semibold text-[var(--text)]">
                {chat.title ?? chat.displayTitle ?? 'Комната'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Переименование и приглашение участников без перезагрузки.
              </p>
            </div>
            <button
              className={brandSecondaryButtonCompactClassName}
              onClick={onClose}
              type="button"
            >
              Закрыть
            </button>
          </div>

          <div className="app-scrollbar min-h-0 overflow-y-auto px-5 py-4">
            <div className="grid gap-4">
              <form
                className="brand-surface grid gap-3 p-4"
                onSubmit={(event) => void submitRename(event)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">Название комнаты</p>
                    <p className="text-xs text-[var(--muted)]">
                      {chat.members.length} участник(ов)
                    </p>
                  </div>
                  <span className="text-xs text-[var(--muted)]">{normalizedTitle.length}/100</span>
                </div>

                <input
                  className={brandInputCompactClassName}
                  maxLength={100}
                  onChange={(event) => handleTitleChange(event.target.value)}
                  placeholder="Переименовать комнату"
                  value={title}
                />

                {(renameError || renameSuccess) && (
                  <p
                    className={
                      renameError ? brandDangerNoticeClassName : brandSuccessNoticeClassName
                    }
                  >
                    {renameError ?? renameSuccess}
                  </p>
                )}

                <button
                  className={brandPrimaryButtonCompactClassName}
                  disabled={
                    renameMutation.isPending ||
                    Boolean(groupTitleError(title)) ||
                    normalizedTitle === (chat.title ?? '').trim()
                  }
                  type="submit"
                >
                  {renameMutation.isPending ? 'Сохраняю...' : 'Сохранить'}
                </button>
              </form>

              <section className="brand-surface grid gap-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">Участники</p>
                    <p className="text-xs text-[var(--muted)]">Текущий состав комнаты</p>
                  </div>
                  <span className="text-xs text-[var(--muted)]">{chat.members.length}</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {chat.members.map((member) => (
                    <span className="brand-pill text-xs text-[var(--text)]" key={member.id}>
                      @{member.user.username ?? member.user.name}
                    </span>
                  ))}
                </div>
              </section>

              <section className="brand-surface grid gap-3 p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">Пригласить по @username</p>
                  <p className="text-xs text-[var(--muted)]">
                    Найдём пользователя и сразу добавим в комнату.
                  </p>
                </div>

                <input
                  className={brandInputCompactClassName}
                  disabled={addMemberMutation.isPending}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  placeholder="Поиск @username"
                  spellCheck={false}
                  value={search}
                />

                {inviteSuccess && <p className={brandSuccessNoticeClassName}>{inviteSuccess}</p>}

                {normalizedSearch.length > 0 && normalizedSearch.length < 3 && (
                  <p className="text-sm text-[var(--muted)]">Введи минимум 3 символа.</p>
                )}

                {normalizedSearch.length >= 3 && (
                  <div className="brand-surface-muted p-2">
                    <UserSearchResults
                      actionLabel={addMemberMutation.isPending ? 'Добавляю...' : 'Добавить'}
                      disabledUsername={null}
                      emptyLabel={
                        userSearch.data?.users?.length
                          ? 'Все найденные пользователи уже в комнате'
                          : 'Никого не нашли'
                      }
                      isPending={userSearch.isPending}
                      onAction={(username) => addMemberMutation.mutate(username)}
                      users={availableUsers}
                    />

                    {inviteError && (
                      <p className="p-2 text-xs text-[var(--danger)]">{inviteError}</p>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ChatView({
  chat,
  currentUserId,
  onConsumeRoomPanelRequest,
  socket,
  roomPanelRequestChatId,
  roomPanelRequestVersion,
  onBack,
  onOpenSidebar,
  voicePanel,
}: {
  chat: Chat;
  currentUserId: string;
  onConsumeRoomPanelRequest: () => void;
  socket: ChatSocket | null;
  roomPanelRequestChatId: string | null;
  roomPanelRequestVersion: number;
  onBack: () => void;
  onOpenSidebar: () => void;
  voicePanel: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [roomPanelOpen, setRoomPanelOpen] = useState(false);
  const messagesScrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const pendingHistoryRestoreRef = useRef<{
    pageCount: number;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const allowDelete = canDeleteChat(chat, currentUserId);

  const messagesQuery = useInfiniteQuery({
    queryKey: ['messages', chat.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getMessages(chat.id, pageParam ?? undefined),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const deleteChatMutation = useMutation({
    mutationFn: () => api.deleteChat(chat.id),
    onSuccess: () => {
      clearChatClientState(queryClient, chat.id);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      onBack();
    },
    onError: (caught) => {
      setActionError(errorMessage(caught));
    },
  });

  const leaveChatMutation = useMutation({
    mutationFn: () => api.leaveGroupChat(chat.id),
    onSuccess: () => {
      clearChatClientState(queryClient, chat.id);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      onBack();
    },
    onError: (caught) => {
      setActionError(errorMessage(caught));
    },
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
    setActionError(null);
  }, [chat.id]);

  useEffect(() => {
    stickToBottomRef.current = true;
    pendingHistoryRestoreRef.current = null;
  }, [chat.id]);

  useEffect(() => {
    if (roomPanelRequestChatId !== chat.id) return;
    setRoomPanelOpen(true);
    onConsumeRoomPanelRequest();
  }, [chat.id, onConsumeRoomPanelRequest, roomPanelRequestChatId, roomPanelRequestVersion]);

  const messages =
    messagesQuery.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => page.messages) ?? [];
  const pageCount = messagesQuery.data?.pages.length ?? 0;
  const nextCursor =
    messagesQuery.data?.pages[messagesQuery.data.pages.length - 1]?.nextCursor ?? null;
  const latestMessageId = messages[messages.length - 1]?.id ?? null;
  const typingUsers = chat.members
    .map((member) => member.user)
    .filter((user) => typingUserIds.includes(user.id) && user.id !== currentUserId)
    .map((user) => `@${user.username ?? user.name}`);

  useEffect(() => {
    const pendingRestore = pendingHistoryRestoreRef.current;
    const scroller = messagesScrollerRef.current;

    if (!pendingRestore || !scroller || messagesQuery.isFetchingNextPage) return;

    if (pageCount > pendingRestore.pageCount) {
      scroller.scrollTop =
        pendingRestore.scrollTop + (scroller.scrollHeight - pendingRestore.scrollHeight);
    }

    pendingHistoryRestoreRef.current = null;
  }, [messagesQuery.isFetchingNextPage, pageCount]);

  useEffect(() => {
    const scroller = messagesScrollerRef.current;
    if (!scroller || pendingHistoryRestoreRef.current || !stickToBottomRef.current) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [chat.id, latestMessageId]);

  useEffect(() => {
    const scroller = messagesScrollerRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current || pendingHistoryRestoreRef.current) return;
      scroller.scrollTop = scroller.scrollHeight;
    });

    observer.observe(scroller);

    return () => {
      observer.disconnect();
    };
  }, []);

  const actionPending = leaveChatMutation.isPending || deleteChatMutation.isPending;
  const chatActions =
    chat.type === 'group'
      ? buildGroupChatActionItems({
          allowDelete,
          disabled: actionPending,
          onDelete: () => {
            setActionError(null);
            deleteChatMutation.mutate();
          },
          onLeave: () => {
            setActionError(null);
            leaveChatMutation.mutate();
          },
          onManage: () => {
            setActionError(null);
            setRoomPanelOpen(true);
          },
        })
      : [unavailableDirectChatAction()];

  async function loadOlderMessages() {
    const scroller = messagesScrollerRef.current;

    if (scroller) {
      pendingHistoryRestoreRef.current = {
        pageCount,
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
      };
      stickToBottomRef.current = false;
    }

    try {
      await messagesQuery.fetchNextPage();
    } catch (caught) {
      pendingHistoryRestoreRef.current = null;
      throw caught;
    }
  }

  function handleMessagesScroll() {
    const scroller = messagesScrollerRef.current;
    if (!scroller) return;

    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 48;
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(8,9,11,0.98),rgba(5,5,7,0.98))]">
      <header className="flex min-h-[78px] shrink-0 items-center justify-between border-b brand-divider px-4 md:px-5">
        <button
          className="min-w-0 flex-1 rounded-2xl text-left outline-none md:cursor-default"
          onClick={onOpenSidebar}
          type="button"
        >
          <p className="brand-display truncate text-lg font-semibold text-[var(--text)]">
            {chat.displayTitle ?? chat.title ?? 'Chat'}
          </p>
          <p className="text-xs text-[var(--muted)]">{chat.members.length} members</p>
        </button>

        <div className="ml-4 flex shrink-0 items-center">
          <ChatActionsMenu items={chatActions} />
        </div>
      </header>

      {actionError && (
        <div className="border-b brand-divider px-4 py-3 md:px-5">
          <p className={brandDangerNoticeClassName}>{actionError}</p>
        </div>
      )}

      <div className="min-w-0 shrink-0">
        <Suspense
          fallback={
            <div className="border-b brand-divider px-4 py-3 text-sm text-[var(--muted)]">
              Голос...
            </div>
          }
        >
          {voicePanel}
        </Suspense>
      </div>

      <div className="flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden px-4 py-4 md:px-6">
        <div
          className="app-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pr-1"
          onScroll={handleMessagesScroll}
          ref={messagesScrollerRef}
        >
          {messagesQuery.isPending && (
            <p className="text-sm text-[var(--muted)]">Гружу сообщения...</p>
          )}

          {messages.length === 0 && !messagesQuery.isPending && (
            <div className="brand-surface grid place-items-center px-5 py-10 text-center">
              <GoidaLogo
                className="mb-4 block w-20"
                imageClassName="h-auto w-full object-contain opacity-90"
                variant="mark"
              />
              <p className="brand-display text-lg text-[var(--text)]">Пока пусто</p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
                Write the first message and start the conversation.
              </p>
            </div>
          )}

          {nextCursor && (
            <div className="mb-3 flex justify-center">
              <button
                className={`${brandSecondaryButtonCompactClassName} text-xs`}
                onClick={() => void loadOlderMessages()}
                type="button"
              >
                Показать старые
              </button>
            </div>
          )}

          <div className="brand-card min-w-0 divide-y divide-[var(--border)] overflow-hidden">
            {messages.map((message) => {
              const own = message.userId === currentUserId;

              return (
                <div className="px-4 py-3" key={message.id}>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span
                        className={`text-sm font-medium ${own ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}
                      >
                        {own ? 'Ты' : `@${message.user.username ?? message.user.name}`}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {formatChatTime(message.createdAt)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-[var(--text)]">
                    {message.text}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t brand-divider bg-[rgba(11,12,15,0.92)] p-3">
        {error && <p className="mb-2 text-sm text-[var(--danger)]">{error}</p>}
        {typingUsers.length > 0 && (
          <p className="mb-2 text-xs text-[var(--muted)]">{typingUsers.join(', ')} печатает...</p>
        )}

        <form className="flex items-stretch gap-2 max-sm:flex-col sm:flex-row" onSubmit={send}>
          <input
            className={`${brandInputClassName} min-w-0 flex-1`}
            maxLength={4000}
            onChange={(event) => setText(event.target.value)}
            placeholder="Написать сообщение..."
            value={text}
          />
          <button className={`${brandPrimaryButtonClassName} shrink-0`}>Отправить</button>
        </form>
      </footer>

      {chat.type === 'group' && (
        <GroupSettingsModal
          chat={chat}
          onClose={() => setRoomPanelOpen(false)}
          open={roomPanelOpen}
        />
      )}
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
  const [roomPanelRequestChatId, setRoomPanelRequestChatId] = useState<string | null>(null);
  const [roomPanelRequestVersion, setRoomPanelRequestVersion] = useState(0);
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
  const [activeVoiceChatId, setActiveVoiceChatId] = useState<string | null>(null);
  const [voiceSession, setVoiceSession] = useState<VoiceToken | null>(null);
  const [voiceConnectEnabled, setVoiceConnectEnabled] = useState(false);
  const [voiceJoinPendingChatId, setVoiceJoinPendingChatId] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceDeafened, setVoiceDeafened] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [voiceCapturePreferences, setVoiceCapturePreferences] = useState<
    Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionMode'>
  >(() => {
    const prefs = readVoiceCapturePreferences();
    return {
      autoGainControl: prefs.autoGainControl,
      echoCancellation: prefs.echoCancellation,
    };
  });
  const [noiseSuppressionMode, setNoiseSuppressionMode] = useState<NoiseSuppressionMode>(
    () => readVoiceCapturePreferences().noiseSuppressionMode,
  );
  const [noiseSuppressionState, setNoiseSuppressionState] = useState<NoiseSuppressionRuntimeState>(
    () => ({
      effectiveMode: readVoiceCapturePreferences().noiseSuppressionMode,
      error: null,
    }),
  );
  const { remoteParticipantVolumes: voiceRemoteParticipantVolumes, setRemoteParticipantVolume } =
    usePersistentPeerVolumes(baseUser?.id ?? null);
  const { activeDeviceId, devices, setMicDeviceId } = useAudioDevices();
  const activeVoiceChatIdRef = useRef<string | null>(null);
  const voicePresenceChatIdRef = useRef<string | null>(null);
  const voiceDisconnectActionRef = useRef<VoiceDisconnectAction | null>(null);
  const pendingVoiceSwitchChatRef = useRef<Chat | null>(null);
  const activeVoiceChat = useMemo(
    () => chats.find((chat) => chat.id === activeVoiceChatId) ?? null,
    [activeVoiceChatId, chats],
  );
  const voiceCaptureOptions = useMemo<VoiceCapturePreferences>(
    () => ({
      autoGainControl: voiceCapturePreferences.autoGainControl,
      echoCancellation: voiceCapturePreferences.echoCancellation,
      micDeviceId: activeDeviceId,
      noiseSuppressionMode,
    }),
    [activeDeviceId, noiseSuppressionMode, voiceCapturePreferences],
  );

  useEffect(() => {
    setLocalUsername(baseUser?.username ?? null);
    currentUserIdRef.current = baseUser?.id ?? null;
  }, [baseUser?.id, baseUser?.username]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    activeVoiceChatIdRef.current = activeVoiceChatId;
  }, [activeVoiceChatId]);

  useEffect(() => {
    writeVoiceCapturePreferences(
      {
        autoGainControl: voiceCapturePreferences.autoGainControl,
        echoCancellation: voiceCapturePreferences.echoCancellation,
      },
      readVoiceCapturePreferences(),
    );
  }, [voiceCapturePreferences]);

  useEffect(() => {
    writeVoiceCapturePreferences({ noiseSuppressionMode }, readVoiceCapturePreferences());
  }, [noiseSuppressionMode]);

  useEffect(() => {
    setNoiseSuppressionState({
      effectiveMode: noiseSuppressionMode,
      error: null,
    });
  }, [noiseSuppressionMode]);

  useEffect(() => {
    setVoiceSettingsOpen(false);
  }, [activeVoiceChatId]);

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
    if (!activeVoiceChatId) return;
    if (chats.some((chat) => chat.id === activeVoiceChatId)) return;

    pendingVoiceSwitchChatRef.current = null;
    voiceDisconnectActionRef.current = 'removed';
    setVoiceConnectEnabled(false);

    if (!voiceSession) {
      if (voicePresenceChatIdRef.current) {
        socket?.emit('voice:left', { chatId: voicePresenceChatIdRef.current });
        voicePresenceChatIdRef.current = null;
      }
      voiceDisconnectActionRef.current = null;
      setActiveVoiceChatId(null);
      setVoiceSession(null);
      setVoiceJoinPendingChatId(null);
    }
  }, [activeVoiceChatId, chats, socket, voiceSession]);

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

    nextSocket.on('chat:created', (chat) => {
      queryClient.setQueryData<ChatListData>(['chats'], (old) =>
        old ? upsertChat(old, chat) : { chats: [chat] },
      );
      if (!selectedChatIdRef.current) {
        setSelectedChatId(chat.id);
      }
    });

    nextSocket.on('chat:updated', (chat) => {
      queryClient.setQueryData<ChatListData>(['chats'], (old) =>
        old ? upsertChat(old, chat) : { chats: [chat] },
      );
    });

    nextSocket.on('chat:deleted', ({ chatId }) => {
      clearChatClientState(queryClient, chatId);
      setSelectedChatId((current) => (current === chatId ? null : current));
    });

    nextSocket.on('chat:member-added', ({ chatId }) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['voicePresence', chatId] });
    });

    nextSocket.on('chat:member-removed', ({ chatId }) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['voicePresence', chatId] });
    });

    nextSocket.on('voice:presence:update', ({ chatId, users }) => {
      queryClient.setQueryData(['voicePresence', chatId], { users });
    });

    nextSocket.on('user:updated', ({ user }) => {
      if (user.id === currentUserIdRef.current) {
        setLocalUsername(user.username ?? user.name);
      }
      patchUserCaches(queryClient, user, currentUserIdRef.current);
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

  useEffect(() => {
    const chatId = voicePresenceChatIdRef.current;
    if (!socket || !chatId) return;

    socket.emit('voice:join', { chatId });
  }, [socket]);

  async function startVoiceJoin(chat: Chat) {
    setVoiceJoinPendingChatId(chat.id);
    setVoiceError(null);

    try {
      const token = await api.getVoiceToken(chat.id);
      setActiveVoiceChatId(chat.id);
      setVoiceSession(token);
      setVoiceConnectEnabled(true);
    } catch (caught) {
      setVoiceError(errorMessage(caught));
    } finally {
      setVoiceJoinPendingChatId(null);
    }
  }

  function clearVoicePresence() {
    const chatId = voicePresenceChatIdRef.current;
    if (!chatId) return;

    socket?.emit('voice:left', { chatId });
    voicePresenceChatIdRef.current = null;
  }

  function finalizeVoiceDisconnect(action: VoiceDisconnectAction | null) {
    clearVoicePresence();
    setVoiceConnectEnabled(false);
    setVoiceSession(null);
    setActiveVoiceChatId(null);
    setVoiceJoinPendingChatId(null);

    const nextChat = action === 'switch' ? pendingVoiceSwitchChatRef.current : null;
    pendingVoiceSwitchChatRef.current = null;
    voiceDisconnectActionRef.current = null;

    if (!action) {
      setVoiceError((current) => current ?? 'Звонок завершился из-за ошибки подключения.');
    }

    if (nextChat) {
      void startVoiceJoin(nextChat);
    }
  }

  function leaveVoiceChat() {
    if (!voiceSession && !activeVoiceChatId) return;

    pendingVoiceSwitchChatRef.current = null;
    voiceDisconnectActionRef.current = 'leave';
    setVoiceConnectEnabled(false);

    if (!voiceSession) {
      finalizeVoiceDisconnect('leave');
    }
  }

  function joinVoiceChat(chat: Chat) {
    if (voiceJoinPendingChatId) return;

    const currentVoiceChatId = activeVoiceChatIdRef.current;
    if (currentVoiceChatId === chat.id && (voiceSession || voiceConnectEnabled)) {
      setVoiceError(null);
      setSelectedChatId(chat.id);
      return;
    }

    if (
      currentVoiceChatId &&
      currentVoiceChatId !== chat.id &&
      (voiceSession || voiceConnectEnabled)
    ) {
      const confirmed = window.confirm('Вы уже в другом звонке. Перейти?');
      if (!confirmed) return;

      setVoiceJoinPendingChatId(chat.id);
      pendingVoiceSwitchChatRef.current = chat;
      voiceDisconnectActionRef.current = 'switch';
      setVoiceConnectEnabled(false);

      if (!voiceSession) {
        finalizeVoiceDisconnect('switch');
      }
      return;
    }

    void startVoiceJoin(chat);
  }

  async function signOut() {
    await authClient.signOut();
    navigate('/login', { replace: true });
  }

  function handleProfileSaved(user: PublicUser) {
    setLocalUsername(user.username ?? user.name);
    patchUserCaches(queryClient, user, currentUserIdRef.current);
    setProfileOpen(false);
    setSocketGeneration((value) => value + 1);
    queryClient.invalidateQueries({ queryKey: ['chats'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['voicePresence'] });
  }

  function handleOpenGroupManager(chatId: string) {
    setSelectedChatId(chatId);
    setRoomPanelRequestChatId(chatId);
    setRoomPanelRequestVersion((value) => value + 1);
  }

  function handleVoiceConnected() {
    const chatId = activeVoiceChatIdRef.current;
    if (!chatId) return;

    setVoiceError(null);

    if (voicePresenceChatIdRef.current === chatId) {
      return;
    }

    socket?.emit('voice:join', { chatId });
    voicePresenceChatIdRef.current = chatId;
  }

  function handleVoiceDisconnected() {
    finalizeVoiceDisconnect(voiceDisconnectActionRef.current);
  }

  if (!baseUser) return <LoadingScreen />;

  const currentUser: CurrentUser = {
    ...baseUser,
    username: localUsername ?? baseUser.username ?? baseUser.name,
  };
  const voicePanel = selectedChat ? (
    <VoicePanel
      activeDeviceId={activeDeviceId}
      activeVoiceChat={activeVoiceChat}
      capturePreferences={voiceCapturePreferences}
      chat={selectedChat}
      deafened={voiceDeafened}
      devices={devices}
      error={voiceError}
      hasActiveVoiceSession={!!voiceSession && !!activeVoiceChatId}
      isVoiceJoinPending={voiceJoinPendingChatId === selectedChat.id}
      noiseSuppressionMode={noiseSuppressionMode}
      noiseSuppressionState={noiseSuppressionState}
      onCloseSettings={() => setVoiceSettingsOpen(false)}
      onJoinVoice={joinVoiceChat}
      onLeaveVoice={leaveVoiceChat}
      onOpenSettings={() => setVoiceSettingsOpen(true)}
      onRemoteParticipantVolumeChange={(remoteUserId, nextValue) => {
        setRemoteParticipantVolume(remoteUserId, nextValue);
      }}
      onReturnToVoice={() => {
        if (activeVoiceChatId) {
          setSelectedChatId(activeVoiceChatId);
        }
      }}
      onToggleDeafen={() => setVoiceDeafened((value) => !value)}
      remoteParticipantVolumes={voiceRemoteParticipantVolumes}
      setCapturePreferences={setVoiceCapturePreferences}
      setMicDeviceId={setMicDeviceId}
      setNoiseSuppressionMode={setNoiseSuppressionMode}
      settingsOpen={voiceSettingsOpen}
    />
  ) : null;
  const rightPaneContent = selectedChat ? (
    <ChatView
      chat={selectedChat}
      currentUserId={currentUser.id}
      onConsumeRoomPanelRequest={() => setRoomPanelRequestChatId(null)}
      onBack={() => setSelectedChatId(null)}
      onOpenSidebar={() => setSidebarOpen(true)}
      roomPanelRequestChatId={roomPanelRequestChatId}
      roomPanelRequestVersion={roomPanelRequestVersion}
      socket={socket}
      voicePanel={voicePanel}
    />
  ) : (
    <section className="grid h-full min-h-0 place-items-center overflow-hidden px-4 text-center">
      <div className="brand-card grid max-w-lg gap-4 px-6 py-8">
        <GoidaLogo
          className="mx-auto block w-20"
          imageClassName="h-auto w-full object-contain"
          variant="mark"
        />
        <div>
          <p className="brand-eyebrow text-[11px] text-[var(--muted)]">Goida workspace</p>
          <p className="brand-display mt-3 text-2xl font-semibold text-[var(--text)]">
            {activeVoiceChat ? 'Звонок всё ещё активен' : 'Выбери чат или создай новый'}
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            {activeVoiceChat
              ? `Сессия в ${activeVoiceChat.displayTitle ?? activeVoiceChat.title ?? 'комнате'} ждёт тебя и не прерывается.`
              : 'Слева уже готов список диалогов, комнат и быстрых действий. Выбери нужный контур и продолжай разговор.'}
          </p>
        </div>
        {activeVoiceChat && (
          <button
            className={brandPrimaryButtonClassName}
            onClick={() => setSelectedChatId(activeVoiceChat.id)}
            type="button"
          >
            К звонку
          </button>
        )}
        <button
          className={`${brandSecondaryButtonClassName} md:hidden`}
          onClick={() => setSidebarOpen(true)}
          type="button"
        >
          Открыть список чатов
        </button>
      </div>
    </section>
  );
  const rightPane =
    voiceSession && activeVoiceChatId ? (
      <LiveKitRoom
        audio={buildAudioCaptureOptions(voiceCaptureOptions)}
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
        connect={voiceConnectEnabled}
        connectOptions={{ autoSubscribe: true, maxRetries: 12 }}
        onConnected={handleVoiceConnected}
        onDisconnected={handleVoiceDisconnected}
        onError={(nextError) => setVoiceError(nextError.message)}
        options={{
          adaptiveStream: true,
          audioCaptureDefaults: buildAudioCaptureOptions(voiceCaptureOptions),
          dynacast: true,
          stopLocalTrackOnUnpublish: false,
        }}
        serverUrl={voiceSession.url}
        token={voiceSession.token}
        video={false}
      >
        <ConnectedVoiceRuntime
          activeDeviceId={activeDeviceId}
          capturePreferences={voiceCapturePreferences}
          deafened={voiceDeafened}
          noiseSuppressionMode={noiseSuppressionMode}
          onNoiseSuppressionStateChange={setNoiseSuppressionState}
          onError={setVoiceError}
        />
        {rightPaneContent}
      </LiveKitRoom>
    ) : (
      rightPaneContent
    );

  return (
    <>
      <main className="grid h-dvh min-h-0 grid-cols-1 overflow-hidden bg-[linear-gradient(180deg,rgba(8,9,11,1),rgba(5,5,7,1))] md:grid-cols-[352px_1fr]">
        <div className="hidden min-h-0 overflow-hidden md:block">
          <ChatSidebar
            chats={chats}
            currentUser={currentUser}
            onOpenGroupManager={handleOpenGroupManager}
            onOpenProfile={() => setProfileOpen(true)}
            onSelect={setSelectedChatId}
            onSignOut={signOut}
            selectedChatId={selectedChatId}
            socket={socket}
          />
        </div>

        <div className="min-h-0 min-w-0 overflow-hidden">{rightPane}</div>
      </main>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 overflow-hidden md:hidden">
          <button
            aria-label="Закрыть список чатов"
            className="brand-overlay absolute inset-0"
            onClick={() => setSidebarOpen(false)}
            type="button"
          />
          <div className="absolute inset-y-0 left-0 h-full w-[min(88vw,352px)] overflow-hidden">
            <ChatSidebar
              chats={chats}
              currentUser={currentUser}
              onOpenGroupManager={handleOpenGroupManager}
              onOpenProfile={() => setProfileOpen(true)}
              onSelect={setSelectedChatId}
              onSignOut={signOut}
              selectedChatId={selectedChatId}
              socket={socket}
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
      <Route element={<Navigate replace to="/app" />} path="*" />
    </Routes>
  );
}
