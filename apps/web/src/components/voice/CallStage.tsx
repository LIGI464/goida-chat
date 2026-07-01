import {
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRemoteParticipants,
  useTracks,
} from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-core';
import { ConnectionState, Track } from 'livekit-client';
import { useEffect, useMemo } from 'react';

import { useAudioLevelMeter } from '../../features/voice/audio/useAudioLevelMeter';
import type {
  NoiseSuppressionLevel,
  VoiceCapturePreferences,
} from '../../features/voice/audio/audioConstraints';
import { DEFAULT_VOICE_PEER_VOLUME } from '../../features/voice/audio/usePersistentPeerVolumes';
import type { Chat, PublicUser } from '../../lib/api';
import { AudioSettingsDrawer } from './AudioSettingsDrawer';
import { CallControls } from './CallControls';
import { ParticipantTile } from './ParticipantTile';

function resolveParticipantUserId(participant: { identity: string; metadata?: string }) {
  if (participant.metadata) {
    try {
      const parsed = JSON.parse(participant.metadata) as { userId?: unknown };
      if (typeof parsed.userId === 'string' && parsed.userId) {
        return parsed.userId;
      }
    } catch {
      // Fall back to LiveKit identity when metadata is absent or malformed.
    }
  }

  return participant.identity;
}

function connectionLabel(connectionState: ConnectionState) {
  if (connectionState === ConnectionState.Reconnecting) {
    return 'Переподключаемся';
  }

  if (connectionState === ConnectionState.SignalReconnecting) {
    return 'Восстанавливаем сигнал';
  }

  return 'Связь стабильна';
}

export function CallStage({
  chat,
  users,
  deafened,
  onToggleDeafen,
  onLeaveVoice,
  onOpenSettings,
  onCloseSettings,
  settingsOpen,
  activeDeviceId,
  devices,
  capturePreferences,
  setCapturePreferences,
  setMicDeviceId,
  noiseSuppressionLevel,
  setNoiseSuppressionLevel,
  remoteParticipantVolumes,
  onRemoteParticipantVolumeChange,
}: {
  chat: Chat;
  users: PublicUser[];
  deafened: boolean;
  onToggleDeafen: () => void;
  onLeaveVoice: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  settingsOpen: boolean;
  activeDeviceId: string;
  devices: MediaDeviceInfo[];
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>;
  setCapturePreferences: (
    next: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>,
  ) => void;
  setMicDeviceId: (next: string) => void;
  noiseSuppressionLevel: NoiseSuppressionLevel;
  setNoiseSuppressionLevel: (next: NoiseSuppressionLevel) => void;
  remoteParticipantVolumes: Record<string, number>;
  onRemoteParticipantVolumeChange: (remoteUserId: string, nextValue: number) => void;
}) {
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const remoteParticipants = useRemoteParticipants();
  const trackRefs = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const { microphoneTrack } = useLocalParticipant();
  const meterTrack = microphoneTrack?.audioTrack?.mediaStreamTrack;
  const meter = useAudioLevelMeter(meterTrack, noiseSuppressionLevel);
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  useEffect(() => {
    for (const participant of remoteParticipants) {
      const remoteUserId = resolveParticipantUserId(participant);
      const nextVolume = remoteParticipantVolumes[remoteUserId];
      participant.setVolume((nextVolume ?? DEFAULT_VOICE_PEER_VOLUME) / 100);
    }
  }, [remoteParticipantVolumes, remoteParticipants]);

  const hasCamera = participants.some((participant) => participant.isCameraEnabled);
  const participantCount = participants.length;
  const stageViewportClass =
    participantCount === 1
      ? 'min-h-[280px] max-h-[min(48vh,420px)] md:min-h-[320px] md:max-h-[min(52vh,460px)]'
      : hasCamera
        ? 'min-h-[320px] max-h-[min(60vh,620px)]'
        : 'min-h-[320px] max-h-[min(56vh,540px)]';
  const participantGridClass =
    participantCount === 1
      ? 'mx-auto max-w-[420px] grid-cols-1'
      : participantCount === 2
        ? 'mx-auto max-w-5xl grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';

  const remoteVolumes = remoteParticipants.map((participant) => {
    const remoteUserId = resolveParticipantUserId(participant);

    return {
      remoteUserId,
      label: `@${userMap.get(remoteUserId)?.username ?? participant.name ?? remoteUserId}`,
      value: remoteParticipantVolumes[remoteUserId] ?? DEFAULT_VOICE_PEER_VOLUME,
    };
  });

  return (
    <section className="shrink-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-4 md:px-6">
      <div className="relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(15,22,36,0.98),rgba(9,14,23,0.98))] shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="flex flex-col gap-4 border-b border-[var(--border)] px-4 py-4 md:px-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-[var(--text)]">
                {chat.displayTitle ?? chat.title ?? 'Комната'}
              </p>
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                {participants.length} в звонке
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                {connectionLabel(connectionState)}
              </span>
              {users.length > 0 && (
                <span className="truncate">
                  {users
                    .map((user) => `@${user.username ?? user.name}`)
                    .slice(0, 4)
                    .join(' / ')}
                </span>
              )}
            </div>
          </div>

          <CallControls
            deafened={deafened}
            onLeaveVoice={onLeaveVoice}
            onOpenSettings={onOpenSettings}
            onToggleDeafen={onToggleDeafen}
          />
        </div>

        <div className="px-4 pb-4 pt-4 md:px-5">
          <div
            className={`voice-stage-scroll overflow-y-auto overflow-x-hidden pr-1 ${stageViewportClass}`}
          >
            <div className={`grid auto-rows-fr gap-3 ${participantGridClass}`}>
              {participants.map((participant) => {
                const trackRef = trackRefs.find(
                  (candidate) => candidate.participant.identity === participant.identity,
                ) as TrackReferenceOrPlaceholder | undefined;
                const remoteUserId = resolveParticipantUserId(participant);
                const user = userMap.get(remoteUserId);
                const displayName = `@${
                  user?.username ?? participant.name ?? user?.name ?? remoteUserId
                }`;

                return (
                  <ParticipantTile
                    compact={participantCount === 1}
                    displayName={displayName}
                    key={participant.identity}
                    participant={participant}
                    trackRef={trackRef}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <AudioSettingsDrawer
          activeDeviceId={activeDeviceId}
          capturePreferences={capturePreferences}
          devices={devices}
          micLevel={meter.level}
          micSpeaking={meter.speaking}
          noiseSuppressionLevel={noiseSuppressionLevel}
          onClose={onCloseSettings}
          onRemoteVolumeChange={onRemoteParticipantVolumeChange}
          open={settingsOpen}
          remoteVolumes={remoteVolumes}
          setCapturePreferences={setCapturePreferences}
          setMicDeviceId={setMicDeviceId}
          setNoiseSuppressionLevel={setNoiseSuppressionLevel}
        />
      </div>
    </section>
  );
}
