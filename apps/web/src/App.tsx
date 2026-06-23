import { signInSchema, signUpSchema } from '@goida-chat/shared';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { authClient } from './lib/auth-client';

const registrationSchema = signUpSchema
  .extend({ repeatPassword: z.string() })
  .refine((value) => value.password === value.repeatPassword, {
    path: ['repeatPassword'],
    message: 'Пароли не совпадают',
  });

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
        const input = registrationSchema.parse({
          email,
          username,
          password,
          repeatPassword,
        });
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

function ChatLayout() {
  const navigate = useNavigate();
  const { data } = authClient.useSession();
  const user = data?.user as
    | {
        name: string;
        username?: string | null;
      }
    | undefined;

  async function signOut() {
    await authClient.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-gray-950 md:grid-cols-[320px_1fr]">
      <aside className="border-r border-gray-800 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="truncate text-sm text-gray-400">@{user?.username ?? user?.name}</span>
          <button className="text-xs text-gray-500 hover:text-gray-200" onClick={signOut}>
            Выйти
          </button>
        </div>
        <input className="w-full rounded-lg bg-gray-900 px-3 py-2" placeholder="Поиск @username" />
        <p className="mt-6 text-sm text-gray-500">Здесь появится список чатов</p>
      </aside>
      <section className="hidden min-h-screen grid-rows-[64px_1fr_72px] md:grid">
        <header className="flex items-center justify-between border-b border-gray-800 px-5">
          <span>Выберите чат</span>
          <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm">Войти в звонок</button>
        </header>
        <div className="grid place-items-center text-gray-600">Сообщения</div>
        <footer className="border-t border-gray-800 p-3">
          <input
            className="w-full rounded-lg bg-gray-900 px-3 py-2"
            placeholder="Написать сообщение…"
          />
        </footer>
      </section>
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
