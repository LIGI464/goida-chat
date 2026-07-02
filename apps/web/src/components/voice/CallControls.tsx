import { TrackToggle, useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';

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

      <button
        className={`${controlClassName} ${tone(false, true)}`}
        onClick={onLeaveVoice}
        type="button"
      >
        Выйти
      </button>
    </div>
  );
}
