import { Link, Navigate, Route, Routes } from 'react-router-dom';

function AuthCard({ mode }: { mode: 'login' | 'register' }) {
  const register = mode === 'register';
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <section className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-xl">
        <h1 className="mb-5 text-2xl font-semibold">{register ? 'Регистрация' : 'Вход'}</h1>
        <form className="grid gap-3">
          <input className="rounded-lg bg-gray-800 px-3 py-2" type="email" placeholder="Email" />
          {register && (
            <input className="rounded-lg bg-gray-800 px-3 py-2" placeholder="username" />
          )}
          <input
            className="rounded-lg bg-gray-800 px-3 py-2"
            type="password"
            placeholder="Пароль"
          />
          <button className="rounded-lg bg-indigo-500 px-3 py-2 font-medium hover:bg-indigo-400">
            {register ? 'Создать аккаунт' : 'Войти'}
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
  return (
    <main className="grid min-h-screen grid-cols-1 bg-gray-950 md:grid-cols-[320px_1fr]">
      <aside className="border-r border-gray-800 p-4">
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
      <Route path="/login" element={<AuthCard mode="login" />} />
      <Route path="/register" element={<AuthCard mode="register" />} />
      <Route path="/app" element={<ChatLayout />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
