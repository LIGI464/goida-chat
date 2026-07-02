import { RoomAudioRenderer, useLocalParticipant } from '@livekit/components-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import {
  buildAudioCaptureOptions,
  type NoiseSuppressionMode,
  type VoiceCapturePreferences,
} from '../../features/voice/audio/audioConstraints';
import {
  type NoiseSuppressionRuntimeState,
  useNoiseSuppression,
} from '../../features/voice/audio/useNoiseSuppression';
import { api, type Chat, type PublicUser } from '../../lib/api';
import { CallStage } from './CallStage';

function VoiceAudioBridge({
  activeDeviceId,
  capturePreferences,
  noiseSuppressionMode,
  onError,
}: {
  activeDeviceId: string;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionMode'>;
  noiseSuppressionMode: NoiseSuppressionMode;
  onError?: (message: string) => void;
}) {
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  const appliedSignature = useRef('');
  const userMuted = !localParticipant.isMicrophoneEnabled;
  const captureOptions = useMemo(
    () =>
      buildAudioCaptureOptions({
        micDeviceId: activeDeviceId,
        noiseSuppressionMode,
        ...capturePreferences,
      }),
    [activeDeviceId, capturePreferences, noiseSuppressionMode],
  );

  const signature = useMemo(
    () => JSON.stringify(captureOptions),
    [captureOptions],
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
        await localParticipant.setMicrophoneEnabled(true, captureOptions);
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
    captureOptions,
    capturePreferences,
    localParticipant,
    microphoneTrack,
    noiseSuppressionMode,
    onError,
    signature,
  ]);

  return null;
}

function VoiceNoiseSuppressionBridge({
  noiseSuppressionMode,
  onStateChange,
}: {
  noiseSuppressionMode: NoiseSuppressionMode;
  onStateChange: (next: NoiseSuppressionRuntimeState) => void;
}) {
  const { microphoneTrack } = useLocalParticipant();
  const state = useNoiseSuppression(microphoneTrack, noiseSuppressionMode);

  useEffect(() => {
    onStateChange(state);
  }, [onStateChange, state]);

  return null;
}

export function ConnectedVoiceRuntime({
  activeDeviceId,
  capturePreferences,
  deafened,
  noiseSuppressionMode,
  onNoiseSuppressionStateChange,
  onError,
}: {
  activeDeviceId: string;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionMode'>;
  deafened: boolean;
  noiseSuppressionMode: NoiseSuppressionMode;
  onNoiseSuppressionStateChange: (next: NoiseSuppressionRuntimeState) => void;
  onError: (message: string | null) => void;
}) {
  return (
    <>
      {!deafened && <RoomAudioRenderer />}

      <VoiceAudioBridge
        activeDeviceId={activeDeviceId}
        capturePreferences={capturePreferences}
        noiseSuppressionMode={noiseSuppressionMode}
        onError={(message) => onError(message)}
      />

      <VoiceNoiseSuppressionBridge
        noiseSuppressionMode={noiseSuppressionMode}
        onStateChange={onNoiseSuppressionStateChange}
      />
    </>
  );
}

function ConnectedVoiceStage({
  activeDeviceId,
  capturePreferences,
  chat,
  deafened,
  devices,
  error,
  noiseSuppressionMode,
  noiseSuppressionState,
  onCloseSettings,
  onLeaveVoice,
  onOpenSettings,
  onRemoteParticipantVolumeChange,
  onToggleDeafen,
  remoteParticipantVolumes,
  setCapturePreferences,
  setMicDeviceId,
  setNoiseSuppressionMode,
  settingsOpen,
  users,
}: {
  activeDeviceId: string;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionMode'>;
  chat: Chat;
  deafened: boolean;
  devices: MediaDeviceInfo[];
  error: string | null;
  noiseSuppressionMode: NoiseSuppressionMode;
  noiseSuppressionState: NoiseSuppressionRuntimeState;
  onCloseSettings: () => void;
  onLeaveVoice: () => void;
  onOpenSettings: () => void;
  onRemoteParticipantVolumeChange: (remoteUserId: string, nextValue: number) => void;
  onToggleDeafen: () => void;
  remoteParticipantVolumes: Record<string, number>;
  setCapturePreferences: (
    next: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionMode'>,
  ) => void;
  setMicDeviceId: (next: string) => void;
  setNoiseSuppressionMode: (next: NoiseSuppressionMode) => void;
  settingsOpen: boolean;
  users: PublicUser[];
}) {
  return (
    <>
      <CallStage
        activeDeviceId={activeDeviceId}
        capturePreferences={capturePreferences}
        chat={chat}
        deafened={deafened}
        devices={devices}
        noiseSuppressionMode={noiseSuppressionMode}
        noiseSuppressionState={noiseSuppressionState}
        onCloseSettings={onCloseSettings}
        onLeaveVoice={onLeaveVoice}
        onOpenSettings={onOpenSettings}
        onRemoteParticipantVolumeChange={onRemoteParticipantVolumeChange}
        onToggleDeafen={onToggleDeafen}
        remoteParticipantVolumes={remoteParticipantVolumes}
        setCapturePreferences={setCapturePreferences}
        setMicDeviceId={setMicDeviceId}
        setNoiseSuppressionMode={setNoiseSuppressionMode}
        settingsOpen={settingsOpen}
        users={users}
      />

      {(error || noiseSuppressionState.error) && (
        <div className="px-4 pb-4 md:px-6">
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {error ?? noiseSuppressionState.error}
          </div>
        </div>
      )}
    </>
  );
}

export function VoicePanel({
  activeDeviceId,
  activeVoiceChat,
  capturePreferences,
  chat,
  deafened,
  devices,
  error,
  hasActiveVoiceSession,
  isVoiceJoinPending,
  noiseSuppressionMode,
  noiseSuppressionState,
  onCloseSettings,
  onJoinVoice,
  onLeaveVoice,
  onOpenSettings,
  onRemoteParticipantVolumeChange,
  onReturnToVoice,
  onToggleDeafen,
  remoteParticipantVolumes,
  setCapturePreferences,
  setMicDeviceId,
  setNoiseSuppressionMode,
  settingsOpen,
}: {
  activeDeviceId: string;
  activeVoiceChat: Chat | null;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionMode'>;
  chat: Chat;
  deafened: boolean;
  devices: MediaDeviceInfo[];
  error: string | null;
  hasActiveVoiceSession: boolean;
  isVoiceJoinPending: boolean;
  noiseSuppressionMode: NoiseSuppressionMode;
  noiseSuppressionState: NoiseSuppressionRuntimeState;
  onCloseSettings: () => void;
  onJoinVoice: (chat: Chat) => void;
  onLeaveVoice: () => void;
  onOpenSettings: () => void;
  onRemoteParticipantVolumeChange: (remoteUserId: string, nextValue: number) => void;
  onReturnToVoice: () => void;
  onToggleDeafen: () => void;
  remoteParticipantVolumes: Record<string, number>;
  setCapturePreferences: (
    next: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionMode'>,
  ) => void;
  setMicDeviceId: (next: string) => void;
  setNoiseSuppressionMode: (next: NoiseSuppressionMode) => void;
  settingsOpen: boolean;
}) {
  const isViewingActiveVoiceChat = hasActiveVoiceSession && activeVoiceChat?.id === chat.id;
  const usersQuery = useQuery({
    queryKey: ['voicePresence', chat.id],
    queryFn: () => api.getVoicePresence(chat.id),
  });
  const activeVoiceUsersQuery = useQuery({
    queryKey: ['voicePresence', activeVoiceChat?.id],
    queryFn: () => api.getVoicePresence(activeVoiceChat!.id),
    enabled: !!activeVoiceChat && activeVoiceChat.id !== chat.id,
  });
  const users = usersQuery.data?.users ?? [];
  const activeVoiceUsers =
    activeVoiceChat?.id === chat.id ? users : activeVoiceUsersQuery.data?.users ?? [];

  if (isViewingActiveVoiceChat && activeVoiceChat) {
    return (
      <ConnectedVoiceStage
        activeDeviceId={activeDeviceId}
        capturePreferences={capturePreferences}
        chat={activeVoiceChat}
        deafened={deafened}
        devices={devices}
        error={error}
        noiseSuppressionMode={noiseSuppressionMode}
        noiseSuppressionState={noiseSuppressionState}
        onCloseSettings={onCloseSettings}
        onLeaveVoice={onLeaveVoice}
        onOpenSettings={onOpenSettings}
        onRemoteParticipantVolumeChange={onRemoteParticipantVolumeChange}
        onToggleDeafen={onToggleDeafen}
        remoteParticipantVolumes={remoteParticipantVolumes}
        setCapturePreferences={setCapturePreferences}
        setMicDeviceId={setMicDeviceId}
        setNoiseSuppressionMode={setNoiseSuppressionMode}
        settingsOpen={settingsOpen}
        users={users}
      />
    );
  }

  const joinLabel =
    activeVoiceChat && activeVoiceChat.id !== chat.id ? 'Перейти в звонок' : 'Войти в звонок';

  return (
    <section className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-4 md:px-6">
      {activeVoiceChat && activeVoiceChat.id !== chat.id && (
        <div className="mb-3 flex flex-col gap-3 rounded-[28px] border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text)]">Активный звонок не прервался</p>
            <p className="truncate text-sm text-[var(--muted)]">
              {activeVoiceChat.displayTitle ?? activeVoiceChat.title ?? 'Комната'}
              {activeVoiceUsers.length > 0 ? ` · ${activeVoiceUsers.length} в звонке` : ''}
            </p>
          </div>

          <button
            className="h-10 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 text-sm font-medium text-[var(--text)] transition-colors duration-150 hover:bg-[var(--panel-2)]"
            onClick={onReturnToVoice}
            type="button"
          >
            Вернуться к звонку
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-[28px] border border-[var(--border)] bg-[var(--panel)] px-4 py-4 shadow-[0_24px_70px_rgba(0,0,0,0.25)] md:flex-row md:items-center md:justify-between md:px-5">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--text)]">Голосовой канал</p>
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
              {users.length} внутри
            </span>
          </div>
          <p className="truncate text-sm text-[var(--muted)]">
            {users.length > 0
              ? users.map((user) => `@${user.username ?? user.name}`).join(' · ')
              : 'Никого нет — можно войти первым.'}
          </p>
        </div>

        <button
          className="h-10 rounded-2xl bg-[var(--accent)] px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isVoiceJoinPending}
          onClick={() => onJoinVoice(chat)}
          type="button"
        >
          {isVoiceJoinPending ? 'Подключаем...' : joinLabel}
        </button>
      </div>

      {error && <p className="pt-3 text-sm text-[var(--danger)]">{error}</p>}
    </section>
  );
}
