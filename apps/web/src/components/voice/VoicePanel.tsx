import { RoomAudioRenderer, useLocalParticipant } from '@livekit/components-react';
import { useQuery } from '@tanstack/react-query';
import { LocalAudioTrack } from 'livekit-client';
import { useEffect, useMemo, useRef } from 'react';

import {
  buildAudioCaptureOptions,
  type NoiseSuppressionLevel,
  type VoiceCapturePreferences,
} from '../../features/voice/audio/audioConstraints';
import { createLiveKitNoiseProcessor } from '../../features/voice/audio/noiseProcessors';
import { api, type Chat, type PublicUser } from '../../lib/api';
import { CallStage } from './CallStage';

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

function VoiceNoiseSuppressionBridge({
  noiseSuppressionLevel,
}: {
  noiseSuppressionLevel: NoiseSuppressionLevel;
}) {
  const { microphoneTrack } = useLocalParticipant();
  const processor = useMemo(
    () => createLiveKitNoiseProcessor(noiseSuppressionLevel),
    [noiseSuppressionLevel],
  );

  useEffect(() => {
    const track = microphoneTrack?.audioTrack;
    if (!(track instanceof LocalAudioTrack)) return;

    const apply = async () => {
      try {
        if (!processor.isSupported() || noiseSuppressionLevel === 'off') {
          await track.stopProcessor();
          return;
        }

        await track.setProcessor(processor);
      } catch {
        await track.stopProcessor();
      }
    };

    void apply();

    return () => {
      void track.stopProcessor();
    };
  }, [microphoneTrack, noiseSuppressionLevel, processor]);

  return null;
}

export function ConnectedVoiceRuntime({
  activeDeviceId,
  capturePreferences,
  deafened,
  noiseSuppressionLevel,
  onError,
}: {
  activeDeviceId: string;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>;
  deafened: boolean;
  noiseSuppressionLevel: NoiseSuppressionLevel;
  onError: (message: string | null) => void;
}) {
  return (
    <>
      {!deafened && <RoomAudioRenderer />}

      <VoiceAudioBridge
        activeDeviceId={activeDeviceId}
        capturePreferences={capturePreferences}
        noiseSuppressionLevel={noiseSuppressionLevel}
        onError={(message) => onError(message)}
      />

      <VoiceNoiseSuppressionBridge noiseSuppressionLevel={noiseSuppressionLevel} />
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
  noiseSuppressionLevel,
  onCloseSettings,
  onLeaveVoice,
  onOpenSettings,
  onRemoteParticipantVolumeChange,
  onToggleDeafen,
  remoteParticipantVolumes,
  setCapturePreferences,
  setMicDeviceId,
  setNoiseSuppressionLevel,
  settingsOpen,
  users,
}: {
  activeDeviceId: string;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>;
  chat: Chat;
  deafened: boolean;
  devices: MediaDeviceInfo[];
  error: string | null;
  noiseSuppressionLevel: NoiseSuppressionLevel;
  onCloseSettings: () => void;
  onLeaveVoice: () => void;
  onOpenSettings: () => void;
  onRemoteParticipantVolumeChange: (identity: string, nextValue: number) => void;
  onToggleDeafen: () => void;
  remoteParticipantVolumes: Record<string, number>;
  setCapturePreferences: (
    next: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>,
  ) => void;
  setMicDeviceId: (next: string) => void;
  setNoiseSuppressionLevel: (next: NoiseSuppressionLevel) => void;
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
        noiseSuppressionLevel={noiseSuppressionLevel}
        onCloseSettings={onCloseSettings}
        onLeaveVoice={onLeaveVoice}
        onOpenSettings={onOpenSettings}
        onRemoteParticipantVolumeChange={onRemoteParticipantVolumeChange}
        onToggleDeafen={onToggleDeafen}
        remoteParticipantVolumes={remoteParticipantVolumes}
        setCapturePreferences={setCapturePreferences}
        setMicDeviceId={setMicDeviceId}
        setNoiseSuppressionLevel={setNoiseSuppressionLevel}
        settingsOpen={settingsOpen}
        users={users}
      />

      {error && <p className="px-4 pb-4 text-sm text-[var(--danger)] md:px-6">{error}</p>}
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
  noiseSuppressionLevel,
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
  setNoiseSuppressionLevel,
  settingsOpen,
}: {
  activeDeviceId: string;
  activeVoiceChat: Chat | null;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>;
  chat: Chat;
  deafened: boolean;
  devices: MediaDeviceInfo[];
  error: string | null;
  hasActiveVoiceSession: boolean;
  isVoiceJoinPending: boolean;
  noiseSuppressionLevel: NoiseSuppressionLevel;
  onCloseSettings: () => void;
  onJoinVoice: (chat: Chat) => void;
  onLeaveVoice: () => void;
  onOpenSettings: () => void;
  onRemoteParticipantVolumeChange: (identity: string, nextValue: number) => void;
  onReturnToVoice: () => void;
  onToggleDeafen: () => void;
  remoteParticipantVolumes: Record<string, number>;
  setCapturePreferences: (
    next: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>,
  ) => void;
  setMicDeviceId: (next: string) => void;
  setNoiseSuppressionLevel: (next: NoiseSuppressionLevel) => void;
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
        noiseSuppressionLevel={noiseSuppressionLevel}
        onCloseSettings={onCloseSettings}
        onLeaveVoice={onLeaveVoice}
        onOpenSettings={onOpenSettings}
        onRemoteParticipantVolumeChange={onRemoteParticipantVolumeChange}
        onToggleDeafen={onToggleDeafen}
        remoteParticipantVolumes={remoteParticipantVolumes}
        setCapturePreferences={setCapturePreferences}
        setMicDeviceId={setMicDeviceId}
        setNoiseSuppressionLevel={setNoiseSuppressionLevel}
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
