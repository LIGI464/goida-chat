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
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildAudioCaptureOptions,
  NOISE_SUPPRESSION_LEVELS,
  readVoiceCapturePreferences,
  type NoiseSuppressionLevel,
  type VoiceCapturePreferences,
  writeVoiceCapturePreferences,
} from '../features/voice/audio/audioConstraints';
import { useAudioDevices } from '../features/voice/audio/useAudioDevices';
import { useAudioLevelMeter } from '../features/voice/audio/useAudioLevelMeter';
import { useNoiseSuppression } from '../features/voice/audio/useNoiseSuppression';
import { api, type Chat, type PublicUser, type VoiceToken } from '../lib/api';
import type { ChatSocket } from '../lib/socket';

function compactName(user: PublicUser | { identity?: string; name?: string | null }) {
  const name =
    'username' in user
      ? (user.username ?? user.name)
      : (user.name ?? ('identity' in user ? user.identity : '') ?? '');

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

function VoiceToggleCluster({
  deafened,
  meterLevel,
  speaking,
  onToggleDeafen,
}: {
  deafened: boolean;
  meterLevel: number;
  speaking: boolean;
  onToggleDeafen: () => void;
}) {
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

      <div className="flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3">
        <span className={`text-xs ${speaking ? 'text-emerald-300' : 'text-[var(--muted)]'}`}>
          {speaking ? 'Говорит' : 'Молчит'}
        </span>
        <div className="h-2 w-20 overflow-hidden rounded-full bg-black/20">
          <div
            className={`h-full rounded-full transition-all ${speaking ? 'bg-emerald-400' : 'bg-[var(--accent)]'}`}
            style={{ width: `${Math.max(8, Math.min(100, meterLevel * 100))}%` }}
          />
        </div>
      </div>

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
                <span className="truncate text-sm text-[var(--text)]">
                  {compactName(participant)}
                </span>
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

function VoiceAudioBridge({
  activeDeviceId,
  capturePreferences,
  noiseSuppressionLevel,
  onError,
}: {
  activeDeviceId: string;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>;
  noiseSuppressionLevel: NoiseSuppressionLevel;
  onError?: (message: string) => void;
}) {
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  const appliedSignature = useRef('');
  const userMuted = !localParticipant.isMicrophoneEnabled;

  const signature = useMemo(
    () =>
      JSON.stringify({
        activeDeviceId,
        capturePreferences,
      }),
    [activeDeviceId, capturePreferences],
  );

  useEffect(() => {
    if (userMuted) {
      appliedSignature.current = '';
    }
  }, [userMuted]);

  useEffect(() => {
    const publication = microphoneTrack?.audioTrack;
    if (!publication || !localParticipant.isMicrophoneEnabled) return;

    if (!appliedSignature.current) {
      appliedSignature.current = signature;
      return;
    }

    if (appliedSignature.current === signature) return;

    let cancelled = false;
    appliedSignature.current = signature;

    const republish = async () => {
      try {
        await localParticipant.setMicrophoneEnabled(false);
        if (cancelled) return;
        await localParticipant.setMicrophoneEnabled(
          true,
          buildAudioCaptureOptions({
            micDeviceId: activeDeviceId,
            noiseSuppressionLevel,
            ...capturePreferences,
          }),
        );
      } catch (caught) {
        appliedSignature.current = '';
        onError?.(
          caught instanceof Error ? caught.message : 'Не удалось применить настройки микрофона',
        );
      }
    };

    void republish();

    return () => {
      cancelled = true;
    };
  }, [
    activeDeviceId,
    capturePreferences,
    localParticipant,
    microphoneTrack,
    noiseSuppressionLevel,
    onError,
    signature,
  ]);

  return null;
}

function VoiceSettingsPanel({
  activeDeviceId,
  devices,
  capturePreferences,
  setCapturePreferences,
  setMicDeviceId,
  noiseSuppressionLevel,
  setNoiseSuppressionLevel,
  microphoneTrack,
}: {
  activeDeviceId: string;
  devices: MediaDeviceInfo[];
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>;
  setCapturePreferences: (
    next: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>,
  ) => void;
  setMicDeviceId: (next: string) => void;
  noiseSuppressionLevel: NoiseSuppressionLevel;
  setNoiseSuppressionLevel: (next: NoiseSuppressionLevel) => void;
  microphoneTrack: ReturnType<typeof useLocalParticipant>['microphoneTrack'];
}) {
  const meterTrack = microphoneTrack?.audioTrack?.mediaStreamTrack;
  const meter = useAudioLevelMeter(meterTrack, noiseSuppressionLevel);
  const activeLevel = NOISE_SUPPRESSION_LEVELS.find(
    (level) => level.value === noiseSuppressionLevel,
  );

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text)]">Настройки звука</p>
        <span className={`text-xs ${meter.speaking ? 'text-emerald-300' : 'text-[var(--muted)]'}`}>
          {meter.speaking ? 'говорит' : 'молчит'}
        </span>
      </div>

      <div className="grid gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-[var(--muted)]">Микрофон</span>
          <select
            className="h-10 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm text-[var(--text)]"
            onChange={(event) => setMicDeviceId(event.target.value)}
            value={activeDeviceId}
          >
            {devices.length === 0 ? <option value={activeDeviceId}>Default</option> : null}
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-xs text-[var(--muted)]">Шумодав</span>
          <select
            className="h-10 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm text-[var(--text)]"
            onChange={(event) =>
              setNoiseSuppressionLevel(event.target.value as NoiseSuppressionLevel)
            }
            value={noiseSuppressionLevel}
          >
            {NOISE_SUPPRESSION_LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--muted)]">{activeLevel?.hint ?? 'Browser DSP only'}</p>
        </label>

        <div className="grid gap-2">
          <label className="flex items-center justify-between gap-3 text-sm text-[var(--text)]">
            <span>Echo cancellation</span>
            <input
              checked={capturePreferences.echoCancellation}
              onChange={(event) =>
                setCapturePreferences({
                  ...capturePreferences,
                  echoCancellation: event.target.checked,
                })
              }
              type="checkbox"
            />
          </label>

          <label className="flex items-center justify-between gap-3 text-sm text-[var(--text)]">
            <span>Auto gain control</span>
            <input
              checked={capturePreferences.autoGainControl}
              onChange={(event) =>
                setCapturePreferences({
                  ...capturePreferences,
                  autoGainControl: event.target.checked,
                })
              }
              type="checkbox"
            />
          </label>

          <label className="flex items-center justify-between gap-3 text-sm text-[var(--text)]">
            <span>Browser noise suppression</span>
            <input
              checked={capturePreferences.noiseSuppression}
              onChange={(event) =>
                setCapturePreferences({
                  ...capturePreferences,
                  noiseSuppression: event.target.checked,
                })
              }
              type="checkbox"
            />
          </label>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--muted)]">Уровень микрофона</span>
            <span className="text-xs text-[var(--muted)]">{Math.round(meter.level * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/20">
            <div
              className={`h-full rounded-full transition-all ${
                meter.speaking ? 'bg-emerald-400' : 'bg-[var(--accent)]'
              }`}
              style={{ width: `${Math.max(4, Math.min(100, meter.level * 100))}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function VoiceRoomSurface({
  chat,
  users,
  expanded,
  deafened,
  onCollapse,
  onExpand,
  onToggleDeafen,
  onError,
}: {
  chat: Chat;
  users: PublicUser[];
  expanded: boolean;
  deafened: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onToggleDeafen: () => void;
  onError: (message: string) => void;
}) {
  const { microphoneTrack } = useLocalParticipant();
  const participants = useRemoteParticipants();
  const totalCount = participants.length + 1;
  const remoteNames = useMemo(() => users.map((user) => `@${user.username ?? user.name}`), [users]);
  const [capturePreferences, setCapturePreferences] = useState<
    Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>
  >(() => {
    const prefs = readVoiceCapturePreferences();
    return {
      autoGainControl: prefs.autoGainControl,
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
    };
  });
  const { activeDeviceId, devices, setMicDeviceId } = useAudioDevices();
  const { noiseSuppressionLevel, setNoiseSuppressionLevel } = useNoiseSuppression(microphoneTrack);
  const meterTrack = microphoneTrack?.audioTrack?.mediaStreamTrack;
  const meter = useAudioLevelMeter(meterTrack, noiseSuppressionLevel);

  useEffect(() => {
    writeVoiceCapturePreferences(
      {
        autoGainControl: capturePreferences.autoGainControl,
        echoCancellation: capturePreferences.echoCancellation,
        noiseSuppression: capturePreferences.noiseSuppression,
      },
      readVoiceCapturePreferences(),
    );
  }, [capturePreferences]);

  return (
    <>
      {!deafened && <RoomAudioRenderer />}

      <VoiceAudioBridge
        activeDeviceId={activeDeviceId}
        capturePreferences={capturePreferences}
        noiseSuppressionLevel={noiseSuppressionLevel}
        onError={onError}
      />

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
            <VoiceToggleCluster
              deafened={deafened}
              meterLevel={meter.level}
              onToggleDeafen={onToggleDeafen}
              speaking={meter.speaking}
            />
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
                  {totalCount} в звонке • аудио всегда с DSP, шумодав можно менять на лету
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <VoiceToggleCluster
                  deafened={deafened}
                  meterLevel={meter.level}
                  onToggleDeafen={onToggleDeafen}
                  speaking={meter.speaking}
                />
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
                          <p className="truncate text-sm text-[var(--text)]">
                            @{user.username ?? user.name}
                          </p>
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
                <VoiceSettingsPanel
                  activeDeviceId={activeDeviceId}
                  capturePreferences={capturePreferences}
                  devices={devices}
                  microphoneTrack={microphoneTrack}
                  setCapturePreferences={setCapturePreferences}
                  setMicDeviceId={setMicDeviceId}
                  setNoiseSuppressionLevel={setNoiseSuppressionLevel}
                  noiseSuppressionLevel={noiseSuppressionLevel}
                />

                <ParticipantVolumeControls />

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3">
                  <p className="mb-2 text-sm text-[var(--text)]">Статус</p>
                  <div className="grid gap-2 text-sm text-[var(--muted)]">
                    <span>Аудио публикуется в LiveKit после входа в звонок.</span>
                    <span>Микрофон можно менять без перезагрузки страницы.</span>
                    <span>Если advanced шумодав недоступен, используется browser DSP.</span>
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
  const initialPreferences = readVoiceCapturePreferences();

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
              {names.length > 0
                ? `${users.length} уже внутри: ${names.join(' • ')}`
                : 'Сейчас никого нет'}
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
      audio={buildAudioCaptureOptions(initialPreferences)}
      connect
      connectOptions={{ autoSubscribe: true, maxRetries: 12 }}
      onConnected={markJoined}
      onDisconnected={markLeft}
      onError={(nextError) => setError(nextError.message)}
      options={{
        adaptiveStream: true,
        audioCaptureDefaults: buildAudioCaptureOptions(initialPreferences),
        dynacast: true,
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
        onError={setError}
        onToggleDeafen={() => setDeafened((value) => !value)}
        users={users}
      />

      {error && <p className="px-4 pb-3 text-sm text-[var(--danger)]">{error}</p>}
    </LiveKitRoom>
  );
}
