import { DisconnectButton, TrackToggle, useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';

function tone(active: boolean, danger = false) {
  if (danger) {
    return 'border-red-500/40 bg-red-500/15 text-red-100 hover:bg-red-500/25';
  }

  return active
    ? 'border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
    : 'border-[var(--border)] bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--panel-2)]';
}

const controlClassName =
  'inline-flex h-11 min-w-[132px] flex-1 items-center justify-center rounded-2xl border px-4 text-sm font-medium whitespace-nowrap transition-colors duration-150 sm:flex-none';

export function CallControls({
  deafened,
  onToggleDeafen,
  onOpenSettings,
}: {
  deafened: boolean;
  onToggleDeafen: () => void;
  onOpenSettings: () => void;
}) {
  const { isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();

  return (
    <div className="flex min-w-0 flex-wrap items-stretch justify-end gap-2">
      <TrackToggle
        className={`${controlClassName} ${tone(isMicrophoneEnabled)}`}
        source={Track.Source.Microphone}
      >
        {isMicrophoneEnabled ? 'Микрофон вкл' : 'Микрофон выкл'}
      </TrackToggle>

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

      <DisconnectButton className={`${controlClassName} ${tone(false, true)}`}>
        Выйти
      </DisconnectButton>
    </div>
  );
}
