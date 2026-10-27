import { useEffect, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { usePrincipalSession } from '../lib/principal-session';
import { clearPendingInvite, savePendingInvite } from '../lib/invite-return';

export function InviteAccessGate({ children }: { children: ReactNode }) {
  const { token = '' } = useParams();
  const session = usePrincipalSession();
  const queryClient = useQueryClient();
  const guest = useMutation({
    mutationFn: () => api.startGuestSession(token),
    onSuccess: (principal) => {
      queryClient.clear();
      queryClient.setQueryData(['session'], principal);
      clearPendingInvite();
    },
  });

  useEffect(() => { savePendingInvite(token); }, [token]);
  useEffect(() => {
    if (session.data?.kind !== 'user') return;
    clearPendingInvite();
    // The existing invite page performs the join. Refresh room lists when it leaves.
    return () => { void queryClient.invalidateQueries({ queryKey: ['chats'] }); };
  }, [session.data?.kind, queryClient]);

  if (session.isPending) return <p className="p-6">Загружаем приглашение...</p>;
  if (session.data?.kind === 'user') return children;
  if (session.data?.kind === 'guest' && session.data.inviteToken === token) {
    return <Navigate replace to={`/app?chat=${encodeURIComponent(session.data.chatId ?? '')}`} />;
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="brand-modal grid w-full max-w-md gap-4 p-6 text-center">
        <h1 className="brand-display text-2xl">Приглашение в комнату</h1>
        <p className="text-sm text-[var(--muted)]">Войди в аккаунт или продолжи без регистрации. Гостевой доступ действует до двух часов и только в этой комнате.</p>
        <Link className="brand-button brand-button-primary h-11" state={{ from: `/invite/${token}` }} to="/login">Войти</Link>
        <Link className="brand-button brand-button-secondary h-11" state={{ from: `/invite/${token}` }} to="/register">Зарегистрироваться</Link>
        <button className="brand-button brand-button-secondary h-11 disabled:opacity-55" disabled={guest.isPending || session.isError} onClick={() => guest.mutate()} type="button">
          {guest.isPending ? 'Подключаем...' : 'Продолжить как гость'}
        </button>
        {(guest.error || session.error) && <p role="alert" className="text-sm text-[var(--danger)]">{(guest.error ?? session.error)?.message}</p>}
      </section>
    </main>
  );
}
