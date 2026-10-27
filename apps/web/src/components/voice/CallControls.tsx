import {
  TrackToggle,
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react';
import { ConnectionState, RoomEvent, Track, type LocalTrack } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';

function tone(active: boolean, danger = false) {
  if (danger) {
    return 'border-[rgba(255,117,130,0.24)] bg-[linear-gradient(180deg,rgba(255,117,130,0.2),rgba(88,19,29,0.2))] text-[#ffd8dd] hover:border-[rgba(255,117,130,0.36)] hover:bg-[linear-gradient(180deg,rgba(255,117,130,0.28),rgba(88,19,29,0.28))]';
  }

  return active
    ? 'border-[rgba(255,255,255,0.18)] bg-[linear-gradient(135deg,#ffffff_0%,#edf0f5_52%,#bcc2ca_100%)] text-[var(--accent-contrast)] hover:bg-[linear-gradient(135deg,#ffffff_0%,#f6f8fc_60%,#d0d6de_100%)]'
    : 'border-[color-mix(in_srgb,var(--border)_84%,white_16%)] bg-[linear-gradient(180deg,rgba(24,26,30,0.98),rgba(15,16,19,0.98))] text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[linear-gradient(180deg,rgba(28,30,35,1),rgba(17,18,22,1))]';
}

const controlClassName =
  'brand-display inline-flex h-10 min-w-[112px] flex-1 items-center justify-center rounded-2xl border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors duration-150 sm:flex-none';

export function CallControls({
  deafened,
  onLeaveVoice,
  onToggleDeafen,
  onOpenSettings,
}: {
  deafened: boolean;
  onLeaveVoice: () => void;
  onToggleDeafen: () => void;
  onOpenSettings: () => void;
}) {
  const { isCameraEnabled, isMicrophoneEnabled, isScreenShareEnabled, localParticipant } =
    useLocalParticipant();
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [screenSharePending, setScreenSharePending] = useState(false);
  const pendingRef = useRef(false);
  const generationRef = useRef(0);
  const activeTrackRef = useRef<LocalTrack | undefined>(undefined);
  const removeEndedListenerRef = useRef<(() => void) | undefined>(undefined);
  const screenShareSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  const stopScreenShare = useCallback(async () => {
    removeEndedListenerRef.current?.();
    removeEndedListenerRef.current = undefined;
    const tracks = new Set([
      activeTrackRef.current,
      localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track,
      localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track,
    ]);
    activeTrackRef.current = undefined;
    // This room uses stopLocalTrackOnUnpublish: false. Stop capture explicitly.
    for (const track of tracks) track?.stop();
    await Promise.all(
      [...tracks].map((track) => track && localParticipant.unpublishTrack(track, true)),
    );
  }, [localParticipant]);

  useEffect(() => {
    const invalidateCapture = () => {
      generationRef.current += 1;
      void stopScreenShare().catch(() => undefined);
    };
    room.on(RoomEvent.Disconnected, invalidateCapture);
    return () => {
      room.off(RoomEvent.Disconnected, invalidateCapture);
      invalidateCapture();
    };
  }, [room, stopScreenShare]);

  async function toggleScreenShare() {
    if (pendingRef.current || room.state !== ConnectionState.Connected) return;
    pendingRef.current = true;
    setScreenSharePending(true);
    const generation = generationRef.current;

    setScreenShareError(null);
    try {
      if (localParticipant.isScreenShareEnabled) {
        await stopScreenShare();
        return;
      }
      if (!screenShareSupported) return;

      const publication = await room.localParticipant.setScreenShareEnabled(
        true,
        {
          video: true,
          audio: false,
          resolution: { width: 1920, height: 1080, frameRate: 30 },
          contentHint: 'detail',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
        },
        { screenShareEncoding: { maxBitrate: 4_000_000, maxFramerate: 30 } },
      );
      const track = publication?.track;
      const mediaTrack = track?.mediaStreamTrack;
      if (generation !== generationRef.current || room.state !== ConnectionState.Connected) {
        track?.stop();
        if (track) await localParticipant.unpublishTrack(track, true);
        return;
      }
      if (!track || !mediaTrack) throw new Error('Не удалось получить поток экрана.');
      activeTrackRef.current = track;
      const handleEnded = () => {
        void stopScreenShare().catch(() => {
          if (generation === generationRef.current) {
            setScreenShareError('Захват остановлен. Не удалось снять публикацию экрана.');
          }
        });
      };
      mediaTrack.addEventListener('ended', handleEnded, { once: true });
      removeEndedListenerRef.current = () => mediaTrack.removeEventListener('ended', handleEnded);
      if (mediaTrack.readyState === 'ended') {
        await stopScreenShare();
        return;
      }
      await mediaTrack.applyConstraints({
        width: { max: 1920 },
        height: { max: 1080 },
        frameRate: { max: 30 },
      });
    } catch (caught) {
      if (generation !== generationRef.current) return;
      await stopScreenShare().catch(() => undefined);
      if (generation !== generationRef.current) return;
      const name = caught instanceof Error ? caught.name : '';
      setScreenShareError(
        name === 'AbortError'
          ? 'Выбор экрана отменён.'
          : name === 'NotAllowedError'
            ? 'Выбор экрана отменён или доступ запрещён. Для повтора разреши доступ в браузере и настройках системы.'
            : caught instanceof Error
              ? caught.message
              : 'Не удалось включить демонстрацию экрана.',
      );
    } finally {
      pendingRef.current = false;
      if (generation === generationRef.current) setScreenSharePending(false);
    }
  }

  function leaveVoice() {
    generationRef.current += 1;
    void stopScreenShare().catch(() => undefined);
    onLeaveVoice();
  }

  return (
    <div className="flex min-w-0 flex-wrap items-stretch justify-end gap-2">
      <TrackToggle
        className={`${controlClassName} ${tone(isMicrophoneEnabled)}`}
        source={Track.Source.Microphone}
      >
        {isMicrophoneEnabled ? 'Микрофон вкл' : 'Микрофон выкл'}
      </TrackToggle>

      <button
        aria-label={isScreenShareEnabled ? 'Остановить демонстрацию экрана' : 'Показать экран'}
        aria-pressed={isScreenShareEnabled}
        className={`${controlClassName} ${tone(isScreenShareEnabled)} disabled:opacity-50`}
        disabled={
          screenSharePending ||
          connectionState !== ConnectionState.Connected ||
          (!screenShareSupported && !isScreenShareEnabled)
        }
        onClick={() => void toggleScreenShare()}
        title={!screenShareSupported ? 'Браузер не поддерживает демонстрацию экрана' : undefined}
        type="button"
      >
        {screenSharePending
          ? 'Подожди…'
          : isScreenShareEnabled
            ? 'Остановить экран'
            : 'Показать экран'}
      </button>

      <TrackToggle
        className={`${controlClassName} ${tone(isCameraEnabled)}`}
        source={Track.Source.Camera}
      >
        {isCameraEnabled ? 'Камера вкл' : 'Камера выкл'}
      </TrackToggle>

      <button
        className={`${controlClassName} ${tone(deafened)}`}
        onClick={onToggleDeafen}
        type="button"
      >
        {deafened ? 'Звук выкл' : 'Звук вкл'}
      </button>

      <button
        className={`${controlClassName} ${tone(false)}`}
        onClick={onOpenSettings}
        type="button"
      >
        Настройки
      </button>

      <button
        aria-label="Выйти из звонка"
        className={`${controlClassName} ${tone(false, true)}`}
        onClick={leaveVoice}
        type="button"
      >
        Выйти
      </button>

      {!screenShareSupported && (
        <p className="basis-full text-right text-xs text-[var(--muted)]">
          Браузер не поддерживает показ экрана. Попробуй браузер на компьютере.
        </p>
      )}
      {screenShareError && (
        <p className="basis-full text-right text-xs text-amber-200/90" role="status">
          {screenShareError}
        </p>
      )}
    </div>
  );
}
