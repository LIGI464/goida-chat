import { useEffect } from 'react';

import {
  NOISE_SUPPRESSION_LEVELS,
  type NoiseSuppressionLevel,
  type VoiceCapturePreferences,
} from '../../features/voice/audio/audioConstraints';

export function AudioSettingsDrawer({
  activeDeviceId,
  devices,
  open,
  onClose,
  capturePreferences,
  setCapturePreferences,
  setMicDeviceId,
  noiseSuppressionLevel,
  setNoiseSuppressionLevel,
  micLevel,
  micSpeaking,
  remoteVolumes,
  onRemoteVolumeChange,
}: {
  activeDeviceId: string;
  devices: MediaDeviceInfo[];
  open: boolean;
  onClose: () => void;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>;
  setCapturePreferences: (
    next: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionLevel'>,
  ) => void;
  setMicDeviceId: (next: string) => void;
  noiseSuppressionLevel: NoiseSuppressionLevel;
  setNoiseSuppressionLevel: (next: NoiseSuppressionLevel) => void;
  micLevel: number;
  micSpeaking: boolean;
  remoteVolumes: Array<{ identity: string; label: string; value: number }>;
  onRemoteVolumeChange: (identity: string, nextValue: number) => void;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const activeLevel = NOISE_SUPPRESSION_LEVELS.find(
    (level) => level.value === noiseSuppressionLevel,
  );

  return (
    <div className="absolute inset-0 z-20 rounded-[inherit]">
      <button
        aria-label="Закрыть настройки звука"
        className="absolute inset-0 rounded-[inherit] bg-black/35"
        onClick={onClose}
        type="button"
      />

      <aside className="absolute inset-x-3 bottom-3 top-16 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-2xl md:inset-x-auto md:right-3 md:w-[340px]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[var(--text)]">Настройки звука</h3>
            <p className="text-sm text-[var(--muted)]">Микрофон, шумодав и обработка аудио.</p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="grid max-h-full gap-4 overflow-auto pr-1">
          <label className="grid gap-1">
            <span className="text-xs text-[var(--muted)]">Микрофон</span>
            <select
              className="h-10 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm text-[var(--text)]"
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
              className="h-10 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm text-[var(--text)]"
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

          <div className="grid gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
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

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm text-[var(--text)]">Уровень микрофона</span>
              <span
                className={`text-xs ${micSpeaking ? 'text-emerald-300' : 'text-[var(--muted)]'}`}
              >
                {micSpeaking ? 'говоришь' : 'тишина'}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/20">
              <div
                className={`h-full rounded-full transition-all ${
                  micSpeaking ? 'bg-emerald-400' : 'bg-[var(--accent)]'
                }`}
                style={{ width: `${Math.max(4, Math.min(100, micLevel * 100))}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Audio processing активен в браузере и LiveKit.
            </p>
          </div>

          {remoteVolumes.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--text)]">Громкость участников</span>
                <span className="text-xs text-[var(--muted)]">0–200%</span>
              </div>

              <div className="grid gap-3">
                {remoteVolumes.map((item) => (
                  <label className="grid gap-1" key={item.identity}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm text-[var(--text)]">{item.label}</span>
                      <span className="text-xs text-[var(--muted)]">{item.value}%</span>
                    </div>
                    <input
                      className="w-full accent-[var(--accent)]"
                      max={200}
                      min={0}
                      onChange={(event) =>
                        onRemoteVolumeChange(item.identity, Number(event.target.value))
                      }
                      type="range"
                      value={item.value}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
