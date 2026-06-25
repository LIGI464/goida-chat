import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant } from '@livekit/components-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildAudioCaptureOptions,
  readVoiceCapturePreferences,
  writeVoiceCapturePreferences,
  type NoiseSuppressionLevel,
  type VoiceCapturePreferences,
} from '../../features/voice/audio/audioConstraints';
import { useAudioDevices } from '../../features/voice/audio/useAudioDevices';
import { useNoiseSuppression } from '../../features/voice/audio/useNoiseSuppression';
import { api, type Chat, type PublicUser, type VoiceToken } from '../../lib/api';
import type { ChatSocket } from '../../lib/socket';
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

function ConnectedVoiceStage({
  activeDeviceId,
  capturePreferences,
  chat,
  deafened,
  devices,
  error,
  onError,
  onToggleDeafen,
  setCapturePreferences,
  setMicDeviceId,
  users,
}: {
  activeDeviceId: string;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>;
  chat: Chat;
  deafened: boolean;
  devices: MediaDeviceInfo[];
  error: string | null;
  onError: (message: string | null) => void;
  onToggleDeafen: () => void;
  setCapturePreferences: (
    next: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>,
  ) => void;
  setMicDeviceId: (next: string) => void;
  users: PublicUser[];
}) {
  const { microphoneTrack } = useLocalParticipant();
  const { noiseSuppressionLevel, setNoiseSuppressionLevel } = useNoiseSuppression(microphoneTrack);

  return (
    <>
      {!deafened && <RoomAudioRenderer />}

      <VoiceAudioBridge
        activeDeviceId={activeDeviceId}
        capturePreferences={capturePreferences}
        noiseSuppressionLevel={noiseSuppressionLevel}
        onError={(message) => onError(message)}
      />

      <CallStage
        activeDeviceId={activeDeviceId}
        capturePreferences={capturePreferences}
        chat={chat}
        deafened={deafened}
        devices={devices}
        noiseSuppressionLevel={noiseSuppressionLevel}
        onToggleDeafen={onToggleDeafen}
        setCapturePreferences={setCapturePreferences}
        setMicDeviceId={setMicDeviceId}
        setNoiseSuppressionLevel={setNoiseSuppressionLevel}
        users={users}
      />

      {error && <p className="px-4 pb-4 text-sm text-[var(--danger)] md:px-6">{error}</p>}
    </>
  );
}

export function VoicePanel({ chat, socket }: { chat: Chat; socket: ChatSocket | null }) {
  const queryClient = useQueryClient();
  const [voice, setVoice] = useState<VoiceToken | null>(null);
  const [deafened, setDeafened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usersQuery = useQuery({
    queryKey: ['voicePresence', chat.id],
    queryFn: () => api.getVoicePresence(chat.id),
  });
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
    writeVoiceCapturePreferences(
      {
        autoGainControl: capturePreferences.autoGainControl,
        echoCancellation: capturePreferences.echoCancellation,
        noiseSuppression: capturePreferences.noiseSuppression,
      },
      readVoiceCapturePreferences(),
    );
  }, [capturePreferences]);

  useEffect(() => {
    setVoice(null);
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
  }

  const users = usersQuery.data?.users ?? [];

  if (!voice) {
    return (
      <section className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-4 md:px-6">
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
            className="h-10 rounded-2xl bg-[var(--accent)] px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)]"
            onClick={joinVoice}
            type="button"
          >
            Войти в звонок
          </button>
        </div>

        {error && <p className="pt-3 text-sm text-[var(--danger)]">{error}</p>}
      </section>
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
      <ConnectedVoiceStage
        activeDeviceId={activeDeviceId}
        capturePreferences={capturePreferences}
        chat={chat}
        deafened={deafened}
        devices={devices}
        error={error}
        onError={setError}
        onToggleDeafen={() => setDeafened((value) => !value)}
        setCapturePreferences={setCapturePreferences}
        setMicDeviceId={setMicDeviceId}
        users={users}
      />
    </LiveKitRoom>
  );
}
