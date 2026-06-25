import {
  ControlBar,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  TrackLoop,
  useConnectionState,
  useRemoteParticipants,
  useTracks,
} from '@livekit/components-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConnectionState, Track } from 'livekit-client';
import { useEffect, useMemo, useState } from 'react';

import { api, type Chat, type PublicUser, type VoiceToken } from '../lib/api';
import type { ChatSocket } from '../lib/socket';

function compactName(user: PublicUser | { identity?: string; name?: string | null }) {
  const name = 'username' in user ? user.username ?? user.name : user.name ?? user.identity ?? '';
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

function VoiceStateBadge() {
  const connectionState = useConnectionState();

  if (connectionState === ConnectionState.Reconnecting) return <span className="text-xs text-amber-300">Переподключение...</span>;
  if (connectionState === ConnectionState.SignalReconnecting) return <span className="text-xs text-amber-300">Восстанавливаем сигнал...</span>;
  return <span className="text-xs text-emerald-300">Связь нормальная</span>;
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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-[var(--text)]">Громкость собеседников</p>
        <p className="text-xs text-[var(--muted)]">0-200%</p>
      </div>
      <div className="grid gap-3">
        {participants.map((participant) => {
          const value = volumes[participant.identity] ?? 100;
          const label = compactName(participant);

          return (
            <label className="grid gap-1" key={participant.sid}>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-[var(--text)]">{label}</span>
                <span className="text-xs text-[var(--muted)]">{value}%</span>
              </div>
              <input
                className="w-full accent-[var(--accent)]"
                min={0}
                max={200}
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
        <ParticipantTile className="min-h-40 overflow-hidden rounded-xl border border-[var(--border)] bg-black/40" />
      </TrackLoop>
    </div>
  );
}

export function VoicePanel({ chat, socket }: { chat: Chat; socket: ChatSocket | null }) {
  const queryClient = useQueryClient();
  const participants = useRemoteParticipants();
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
    return () => socket.off('voice:presence:update', handler);
  }, [chat.id, queryClient, socket]);

  async function joinVoice() {
    setError(null);
    try {
      const token = await api.getVoiceToken(chat.id);
      setVoice(token);
      setExpanded(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось войти в звонок');
    }
  }

  function markJoined() {
    socket?.emit('voice:join', { chatId: chat.id });
  }

  function leaveVoice() {
    socket?.emit('voice:left', { chatId: chat.id });
    setVoice(null);
    setExpanded(false);
  }

  const users = usersQuery.data?.users ?? [];
  const remoteNames = useMemo(
    () => users.map((user) => `@${user.username ?? user.name}`),
    [users],
  );

  if (!voice) {
    return (
      <div className="border-t border-[var(--border)] bg-[var(--panel)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-[var(--text)]">В звонке: {users.length}</p>
            <p className="truncate text-xs text-[var(--muted)]">
              {remoteNames.length > 0 ? remoteNames.join(' • ') : 'Сейчас никто не говорит'}
            </p>
          </div>
          <button
            className="h-9 rounded-xl bg-[var(--success)] px-3 text-sm font-medium text-white transition-colors duration-150 hover:brightness-110"
            onClick={joinVoice}
            type="button"
          >
            Войти в звонок
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 z-20 border-t border-[var(--border)] bg-[var(--panel)]">
      <LiveKitRoom
        audio={{ echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true }}
        connect
        connectOptions={{ maxRetries: 12, autoSubscribe: true }}
        onConnected={markJoined}
        onDisconnected={leaveVoice}
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
        {!deafened && <RoomAudioRenderer />}

        {!expanded ? (
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--success)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-[var(--text)]">
                В звонке: {participants.length + 1}
              </p>
              <p className="truncate text-xs text-[var(--muted)]">
                {users.map((user) => `@${user.username ?? user.name}`).join(' • ') || 'Ты один'}
              </p>
            </div>
            <button
              className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--panel)]"
              onClick={() => setExpanded(true)}
              type="button"
            >
              Развернуть
            </button>
            <button
              className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--panel)]"
              onClick={() => setDeafened((value) => !value)}
              type="button"
            >
              {deafened ? 'Слышать' : 'Заглушить звук'}
            </button>
            <ControlBar
              className="flex flex-wrap gap-2"
              controls={{
                microphone: true,
                camera: true,
                chat: false,
                screenShare: false,
                leave: true,
                settings: false,
              }}
              variation="textOnly"
            />
          </div>
        ) : (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 md:items-center">
            <div className="w-full max-w-5xl rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-2xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--text)]">{chat.displayTitle ?? chat.title ?? 'Чат'}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {users.length} участник(ов) • {remoteNames.join(' • ') || 'никого'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--panel)]"
                    onClick={() => setExpanded(false)}
                    type="button"
                  >
                    Свернуть
                  </button>
                  <button
                    className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--panel)]"
                    onClick={() => setDeafened((value) => !value)}
                    type="button"
                  >
                    {deafened ? 'Слышать' : 'Заглушить звук'}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid gap-3">
                  {users.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {users.map((user) => (
                        <div
                          className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3"
                          key={user.id}
                        >
                          <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--accent)] text-sm font-semibold text-white">
                            {initials(user.username ?? user.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm text-[var(--text)]">@{user.username ?? user.name}</p>
                            <p className="text-xs text-[var(--muted)]">В голосе</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-6 text-sm text-[var(--muted)]">
                      Пока никто не подключился
                    </div>
                  )}
                  <VideoGrid />
                </div>

                <div className="grid gap-3">
                  <ParticipantVolumeControls />
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                    <p className="mb-2 text-sm text-[var(--text)]">Управление</p>
                    <ControlBar
                      className="flex flex-wrap gap-2"
                      controls={{
                        microphone: true,
                        camera: true,
                        chat: false,
                        screenShare: false,
                        leave: true,
                        settings: false,
                      }}
                      variation="textOnly"
                    />
                    <p className="mt-2 text-xs text-[var(--muted)]">Видеорежим включай только когда нужен.</p>
                  </div>
                </div>
              </div>

              {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
            </div>
          </div>
        )}
      </LiveKitRoom>
    </div>
  );
}
