import { signInSchema, signUpSchema } from '@goida-chat/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Suspense,
  lazy,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { api, type Chat, type Message } from './lib/api';
import { authClient } from './lib/auth-client';
import { createChatSocket, type ChatSocket } from './lib/socket';

const VoicePanel = lazy(() =>
  import('./components/VoicePanel').then((module) => ({ default: module.VoicePanel })),
);

const registrationSchema = signUpSchema
  .extend({ repeatPassword: z.string() })
  .refine((value) => value.password === value.repeatPassword, {
    path: ['repeatPassword'],
    message: 'Пароли не совпадают',
  });

type MessagesPage = { messages: Message[]; nextCursor: string | null };

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'Что-то пошло не так. Попробуй ещё раз.';
}

function LoadingScreen() {
  return <main className="grid min-h-screen place-items-center text-gray-500">Загрузка…</main>;
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
      <section className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-xl">
        <h1 className="mb-1 text-2xl font-semibold">{register ? 'Регистрация' : 'Вход'}</h1>
        <p className="mb-5 text-sm text-gray-500">
          {register ? 'Создай приватный аккаунт' : 'С возвращением'}
        </p>
        <form className="grid gap-3" onSubmit={submit}>
          <input
            autoComplete="email"
            className="rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
            type="email"
            value={email}
          />
          {register && (
            <input
              autoComplete="username"
              className="rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
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
            className="rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
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
              className="rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
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
            className="rounded-lg bg-indigo-500 px-3 py-2 font-medium hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending}
          >
            {pending ? 'Подожди…' : register ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
        <Link className="mt-4 block text-sm text-indigo-300" to={register ? '/login' : '/register'}>
          {register ? 'Уже есть аккаунт' : 'Создать аккаунт'}
        </Link>
      </section>
    </main>
  );
}

function ChatSidebar({
  chats,
  currentUserId,
  selectedChatId,
  onSelect,
  onSignOut,
}: {
  chats: Chat[];
  currentUserId: string;
  selectedChatId: string | null;
  onSelect: (chatId: string) => void;
  onSignOut: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [groupMembers, setGroupMembers] = useState('');
  const normalizedSearch = search.trim().toLowerCase();
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
      setGroupTitle('');
      setGroupMembers('');
    },
  });

  function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const usernames = groupMembers
      .split(/[\s,]+/)
      .map((value) => value.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
    groupMutation.mutate({ title: groupTitle.trim(), usernames });
  }

  return (
    <aside className="flex min-h-screen flex-col border-r border-gray-800 bg-gray-950 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-sm text-gray-400">Чаты</span>
        <button className="text-xs text-gray-500 hover:text-gray-200" onClick={onSignOut}>
          Выйти
        </button>
      </div>

      <input
        className="w-full rounded-lg bg-gray-900 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Поиск @username"
        value={search}
      />
      {normalizedSearch.length >= 3 && (
        <div className="mt-2 rounded-xl border border-gray-800 bg-gray-900 p-2">
          {userSearch.isPending && <p className="p-2 text-sm text-gray-500">Ищу…</p>}
          {userSearch.data?.users.length === 0 && (
            <p className="p-2 text-sm text-gray-500">Никого</p>
          )}
          {userSearch.data?.users.map((user) => (
            <button
              className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-gray-800"
              key={user.id}
              onClick={() => directMutation.mutate(user.username ?? '')}
            >
              <span>@{user.username}</span>
              <span className="text-xs text-indigo-300">чат</span>
            </button>
          ))}
          {directMutation.error && (
            <p className="p-2 text-xs text-red-300">{errorMessage(directMutation.error)}</p>
          )}
        </div>
      )}

      <form
        className="mt-4 rounded-xl border border-gray-800 bg-gray-900 p-3"
        onSubmit={createGroup}
      >
        <p className="mb-2 text-sm text-gray-400">Новый общий чат</p>
        <input
          className="mb-2 w-full rounded-lg bg-gray-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          onChange={(event) => setGroupTitle(event.target.value)}
          placeholder="Название"
          required
          value={groupTitle}
        />
        <input
          className="mb-2 w-full rounded-lg bg-gray-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          onChange={(event) => setGroupMembers(event.target.value)}
          placeholder="user1, user2"
          value={groupMembers}
        />
        <button
          className="w-full rounded-lg bg-gray-800 px-3 py-2 text-sm hover:bg-gray-700 disabled:opacity-50"
          disabled={groupMutation.isPending}
        >
          Создать
        </button>
        {groupMutation.error && (
          <p className="mt-2 text-xs text-red-300">{errorMessage(groupMutation.error)}</p>
        )}
      </form>

      <div className="mt-4 min-h-0 flex-1 overflow-auto">
        {chats.length === 0 && <p className="mt-8 text-sm text-gray-500">Пока нет чатов</p>}
        {chats.map((chat) => {
          const active = chat.id === selectedChatId;
          const members = chat.members
            .filter((member) => member.user.id !== currentUserId)
            .map((member) => `@${member.user.username}`)
            .join(', ');
          return (
            <button
              className={`mb-2 w-full rounded-xl border px-3 py-3 text-left transition ${
                active
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-gray-800 bg-gray-900 hover:bg-gray-800'
              }`}
              key={chat.id}
              onClick={() => onSelect(chat.id)}
            >
              <p className="truncate font-medium">{chat.displayTitle ?? chat.title ?? 'Чат'}</p>
              <p className="truncate text-xs text-gray-500">
                {chat.lastMessage?.text ?? members ?? 'Пусто'}
              </p>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function ChatView({
  chat,
  currentUserId,
  socket,
  onBack,
}: {
  chat: Chat;
  currentUserId: string;
  socket: ChatSocket | null;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const messagesQuery = useQuery({
    queryKey: ['messages', chat.id],
    queryFn: () => api.getMessages(chat.id),
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
      queryClient.setQueryData<MessagesPage>(['messages', chat.id], (old) => ({
        messages: [...(old?.messages ?? []), message],
        nextCursor: old?.nextCursor ?? null,
      }));
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setText('');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="grid min-h-screen grid-rows-[64px_auto_1fr_auto] bg-gray-950">
      <header className="flex items-center justify-between border-b border-gray-800 px-4 md:px-5">
        <div className="flex items-center gap-3">
          <button className="text-sm text-gray-400 md:hidden" onClick={onBack}>
            Назад
          </button>
          <div>
            <p className="font-medium">{chat.displayTitle ?? chat.title ?? 'Чат'}</p>
            <p className="text-xs text-gray-500">{chat.members.length} участник(ов)</p>
          </div>
        </div>
        <span className="text-xs text-gray-500">
          {socket?.connected ? 'realtime on' : 'realtime off'}
        </span>
      </header>

      <Suspense
        fallback={
          <div className="border-b border-gray-800 px-4 py-3 text-sm text-gray-500">Voice…</div>
        }
      >
        <VoicePanel chat={chat} socket={socket} />
      </Suspense>

      <div className="min-h-0 overflow-auto px-4 py-4">
        {messagesQuery.isPending && <p className="text-sm text-gray-500">Загружаю сообщения…</p>}
        {messagesQuery.data?.messages.length === 0 && (
          <p className="text-center text-sm text-gray-600">Пока пусто. Напиши первым.</p>
        )}
        <div className="grid gap-3">
          {messagesQuery.data?.messages.map((message) => {
            const own = message.userId === currentUserId;
            return (
              <div className={`flex ${own ? 'justify-end' : 'justify-start'}`} key={message.id}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                    own ? 'bg-indigo-600 text-white' : 'bg-gray-900 text-gray-100'
                  }`}
                >
                  {!own && <p className="mb-1 text-xs text-gray-400">@{message.user.username}</p>}
                  <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="border-t border-gray-800 p-3">
        {error && <p className="mb-2 text-sm text-red-300">{error}</p>}
        <form className="flex gap-2" onSubmit={send}>
          <input
            className="min-w-0 flex-1 rounded-lg bg-gray-900 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            maxLength={4000}
            onChange={(event) => setText(event.target.value)}
            placeholder="Написать сообщение…"
            value={text}
          />
          <button className="rounded-lg bg-indigo-500 px-4 py-2 font-medium hover:bg-indigo-400">
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
  const currentUser = data?.user as
    | { id: string; name: string; username?: string | null }
    | undefined;
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const chatsQuery = useQuery({ queryKey: ['chats'], queryFn: api.listChats });
  const chats = chatsQuery.data?.chats ?? [];
  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? null,
    [chats, selectedChatId],
  );

  useEffect(() => {
    if (!selectedChatId && chats[0]) {
      setSelectedChatId(chats[0].id);
    }
  }, [chats, selectedChatId]);

  useEffect(() => {
    const nextSocket = createChatSocket();
    setSocket(nextSocket);

    nextSocket.on('message:new', (message) => {
      queryClient.setQueryData<MessagesPage>(['messages', message.chatId], (old) => {
        if (!old) return old;
        if (old.messages.some((item) => item.id === message.id)) return old;
        return { ...old, messages: [...old.messages, message] };
      });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    });

    nextSocket.on('message:error', (payload) => {
      console.warn(payload.message);
    });

    return () => {
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [queryClient]);

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

  if (!currentUser) return <LoadingScreen />;

  return (
    <main className="grid min-h-screen grid-cols-1 bg-gray-950 md:grid-cols-[320px_1fr]">
      <div className={selectedChat ? 'hidden md:block' : 'block'}>
        <ChatSidebar
          chats={chats}
          currentUserId={currentUser.id}
          onSelect={setSelectedChatId}
          onSignOut={signOut}
          selectedChatId={selectedChatId}
        />
      </div>
      <div className={selectedChat ? 'block' : 'hidden md:block'}>
        {selectedChat ? (
          <ChatView
            chat={selectedChat}
            currentUserId={currentUser.id}
            onBack={() => setSelectedChatId(null)}
            socket={socket}
          />
        ) : (
          <section className="grid min-h-screen place-items-center text-gray-600">
            Выберите чат
          </section>
        )}
      </div>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <AuthCard mode="login" />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <AuthCard mode="register" />
          </PublicOnly>
        }
      />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <ChatLayout />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
