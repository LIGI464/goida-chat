import {
  DisconnectButton,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  TrackLoop,
  TrackToggle,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
} from '@livekit/components-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConnectionState, Track } from 'livekit-client';
import { useEffect, useMemo, useState } from 'react';

import { api, type Chat, type PublicUser, type VoiceToken } from '../lib/api';
import type { ChatSocket } from '../lib/socket';

function compactName(user: PublicUser | { identity?: string; name?: string | null }) {
  const name =
    'username' in user
      ? user.username ?? user.name
      : user.name ?? ('identity' in user ? user.identity : '') ?? '';

  return String(name ?? '').replace(/^@/, '');
}

function initials(value: string) {
  const parts = value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return '?';

  return parts.map((part) => part[0]!.toUpperCase()).join('');
}

function ConnectionBadge() {
  const connectionState = useConnectionState();

  if (connectionState === ConnectionState.Reconnecting) {
    return <span className="text-xs text-amber-300">Переподключение...</span>;
  }

  if (connectionState === ConnectionState.SignalReconnecting) {
    return <span className="text-xs text-amber-300">Восстанавливаем связь...</span>;
  }

  return <span className="text-xs text-emerald-300">Связь стабильна</span>;
}

function VoiceActionButton({
  children,
  danger = false,
  active = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; active?: boolean }) {
  const tone = danger
    ? 'border-red-500/40 bg-red-500/15 text-red-100 hover:bg-red-500/25'
    : active
      ? 'border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
      : 'border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--panel)]';

  return (
    <button
      className={`h-10 rounded-xl border px-4 text-sm font-medium transition-colors duration-150 ${tone}`}
      {...props}
    >
      {children}
    </button>
  );
}

function VoiceToggleCluster({ deafened, onToggleDeafen }: { deafened: boolean; onToggleDeafen: () => void }) {
  const { isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <TrackToggle
        className={`h-10 rounded-xl border px-4 text-sm font-medium transition-colors duration-150 ${
          isMicrophoneEnabled
            ? 'border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
            : 'border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--panel)]'
        }`}
        source={Track.Source.Microphone}
      >
        {isMicrophoneEnabled ? 'Микрофон: вкл' : 'Микрофон: выкл'}
      </TrackToggle>

      <TrackToggle
        className={`h-10 rounded-xl border px-4 text-sm font-medium transition-colors duration-150 ${
          isCameraEnabled
            ? 'border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
            : 'border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--panel)]'
        }`}
        source={Track.Source.Camera}
      >
        {isCameraEnabled ? 'Камера: вкл' : 'Камера: выкл'}
      </TrackToggle>

      <VoiceActionButton active={deafened} onClick={onToggleDeafen} type="button">
        {deafened ? 'Звук: выкл' : 'Заглушить звук'}
      </VoiceActionButton>

      <DisconnectButton className="h-10 rounded-xl border border-red-500/40 bg-red-500/15 px-4 text-sm font-medium text-red-100 transition-colors duration-150 hover:bg-red-500/25">
        Выйти
      </DisconnectButton>
    </div>
  );
}

function ParticipantVolumeControls() {
  const participants = useRemoteParticipants();
  const [volumes, setVolumes] = useState<Record<string, number>>({});

  useEffect(() => {
    setVolumes((current) => {
      const next: Record<string, number> = {};

      for (const participant of participants) {
        next[participant.identity] = current[participant.identity] ?? 100;
      }

      return next;
    });
  }, [participants]);

  if (participants.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text)]">Громкость собеседников</p>
        <p className="text-xs text-[var(--muted)]">0–200%</p>
      </div>

      <div className="grid gap-3">
        {participants.map((participant) => {
          const value = volumes[participant.identity] ?? 100;

          return (
            <label className="grid gap-1" key={participant.sid}>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-[var(--text)]">{compactName(participant)}</span>
                <span className="text-xs text-[var(--muted)]">{value}%</span>
              </div>
              <input
                className="w-full accent-[var(--accent)]"
                max={200}
                min={0}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  setVolumes((current) => ({ ...current, [participant.identity]: nextValue }));
                  participant.setVolume(nextValue / 100);
                }}
                type="range"
                value={value}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function VideoGrid() {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <TrackLoop tracks={tracks}>
        <ParticipantTile className="min-h-44 overflow-hidden rounded-2xl border border-[var(--border)] bg-black/40" />
      </TrackLoop>
    </div>
  );
}

function VoiceRoomSurface({
  chat,
  users,
  expanded,
  deafened,
  onExpand,
  onCollapse,
  onToggleDeafen,
}: {
  chat: Chat;
  users: PublicUser[];
  expanded: boolean;
  deafened: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onToggleDeafen: () => void;
}) {
  const participants = useRemoteParticipants();
  const totalCount = participants.length + 1;
  const remoteNames = useMemo(() => users.map((user) => `@${user.username ?? user.name}`), [users]);

  return (
    <>
      {!deafened && <RoomAudioRenderer />}

      <div className="border-t border-[var(--border)] bg-[var(--panel)]">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-[var(--text)]">
                Голосовой канал • {totalCount} участник(ов)
              </p>
              <ConnectionBadge />
            </div>
            <p className="truncate text-xs text-[var(--muted)]">
              {remoteNames.length > 0 ? remoteNames.join(' • ') : 'Пока в звонке только ты'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <VoiceToggleCluster deafened={deafened} onToggleDeafen={onToggleDeafen} />
            <VoiceActionButton onClick={expanded ? onCollapse : onExpand} type="button">
              {expanded ? 'Свернуть' : 'Развернуть'}
            </VoiceActionButton>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/75 p-3 md:p-6">
          <div className="mx-auto grid h-full max-w-7xl grid-rows-[auto_1fr] gap-4 rounded-3xl border border-[var(--border)] bg-[var(--bg)] p-4 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-[var(--text)]">
                  {chat.displayTitle ?? chat.title ?? 'Чат'}
                </p>
                <p className="truncate text-sm text-[var(--muted)]">
                  {totalCount} в звонке • видео включается только когда нужно
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <VoiceToggleCluster deafened={deafened} onToggleDeafen={onToggleDeafen} />
                <VoiceActionButton onClick={onCollapse} type="button">
                  Свернуть
                </VoiceActionButton>
              </div>
            </div>

            <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-h-0 overflow-auto rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {users.length > 0 ? (
                    users.map((user) => (
                      <div
                        className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3"
                        key={user.id}
                      >
                        <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--accent)] text-sm font-semibold text-white">
                          {initials(user.username ?? user.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-[var(--text)]">@{user.username ?? user.name}</p>
                          <p className="text-xs text-[var(--muted)]">В звонке</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4 text-sm text-[var(--muted)]">
                      Пока никого кроме тебя
                    </div>
                  )}
                </div>

                <VideoGrid />
              </div>

              <div className="grid content-start gap-4">
                <ParticipantVolumeControls />

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3">
                  <p className="mb-2 text-sm text-[var(--text)]">Статус</p>
                  <div className="grid gap-2 text-sm text-[var(--muted)]">
                    <span>Аудио по умолчанию включено.</span>
                    <span>Камеру включаешь только когда она нужна.</span>
                    <span>При плохой сети звонок старается переподключиться сам.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function VoicePanel({ chat, socket }: { chat: Chat; socket: ChatSocket | null }) {
  const queryClient = useQueryClient();
  const [voice, setVoice] = useState<VoiceToken | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usersQuery = useQuery({
    queryKey: ['voicePresence', chat.id],
    queryFn: () => api.getVoicePresence(chat.id),
  });

  useEffect(() => {
    if (!socket) return;

    const handler = (payload: { chatId: string; users: PublicUser[] }) => {
      if (payload.chatId !== chat.id) return;
      queryClient.setQueryData(['voicePresence', chat.id], { users: payload.users });
    };

    socket.on('voice:presence:update', handler);

    return () => {
      socket.off('voice:presence:update', handler);
    };
  }, [chat.id, queryClient, socket]);

  useEffect(() => {
    setVoice(null);
    setExpanded(false);
    setDeafened(false);
    setError(null);
  }, [chat.id]);

  async function joinVoice() {
    setError(null);

    try {
      const token = await api.getVoiceToken(chat.id);
      setVoice(token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось войти в звонок');
    }
  }

  function markJoined() {
    socket?.emit('voice:join', { chatId: chat.id });
  }

  function markLeft() {
    socket?.emit('voice:left', { chatId: chat.id });
    setVoice(null);
    setExpanded(false);
  }

  const users = usersQuery.data?.users ?? [];
  const names = users.map((user) => `@${user.username ?? user.name}`);

  if (!voice) {
    return (
      <div className="border-t border-[var(--border)] bg-[var(--panel)]">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text)]">Голосовой канал</p>
            <p className="truncate text-xs text-[var(--muted)]">
              {names.length > 0 ? `${users.length} уже внутри: ${names.join(' • ')}` : 'Сейчас никого нет'}
            </p>
          </div>

          <VoiceActionButton active onClick={joinVoice} type="button">
            Войти в звонок
          </VoiceActionButton>
        </div>

        {error && <p className="px-4 pb-3 text-sm text-[var(--danger)]">{error}</p>}
      </div>
    );
  }

  return (
    <LiveKitRoom
      audio={{
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,
      }}
      connect
      connectOptions={{ autoSubscribe: true, maxRetries: 12 }}
      onConnected={markJoined}
      onDisconnected={markLeft}
      onError={(nextError) => setError(nextError.message)}
      options={{
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: true,
        },
        stopLocalTrackOnUnpublish: false,
      }}
      serverUrl={voice.url}
      token={voice.token}
      video={false}
    >
      <VoiceRoomSurface
        chat={chat}
        deafened={deafened}
        expanded={expanded}
        onCollapse={() => setExpanded(false)}
        onExpand={() => setExpanded(true)}
        onToggleDeafen={() => setDeafened((value) => !value)}
        users={users}
      />

      {error && <p className="px-4 pb-3 text-sm text-[var(--danger)]">{error}</p>}
    </LiveKitRoom>
  );
}
