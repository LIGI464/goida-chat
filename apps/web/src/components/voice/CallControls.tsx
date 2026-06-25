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
    <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
      <TrackToggle
        className={`h-10 rounded-2xl border px-4 text-sm font-medium transition-colors duration-150 ${tone(isMicrophoneEnabled)}`}
        source={Track.Source.Microphone}
      >
        {isMicrophoneEnabled ? 'Mic on' : 'Mic off'}
      </TrackToggle>

      <TrackToggle
        className={`h-10 rounded-2xl border px-4 text-sm font-medium transition-colors duration-150 ${tone(isCameraEnabled)}`}
        source={Track.Source.Camera}
      >
        {isCameraEnabled ? 'Camera on' : 'Camera off'}
      </TrackToggle>

      <button
        className={`h-10 rounded-2xl border px-4 text-sm font-medium transition-colors duration-150 ${tone(deafened)}`}
        onClick={onToggleDeafen}
        type="button"
      >
        {deafened ? 'Undeafen' : 'Deafen'}
      </button>

      <button
        className={`h-10 rounded-2xl border px-4 text-sm font-medium transition-colors duration-150 ${tone(false)}`}
        onClick={onOpenSettings}
        type="button"
      >
        Настройки
      </button>

      <DisconnectButton
        className={`h-10 rounded-2xl border px-4 text-sm font-medium transition-colors duration-150 ${tone(false, true)}`}
      >
        Выйти
      </DisconnectButton>
    </div>
  );
}
