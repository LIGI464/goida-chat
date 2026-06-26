import { useEffect } from 'react';

import {
  NOISE_SUPPRESSION_LEVELS,
  type NoiseSuppressionLevel,
  type VoiceCapturePreferences,
} from '../../features/voice/audio/audioConstraints';

function ToggleRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 items-start justify-between gap-3 rounded-2xl border border-[var(--border)] bg-black/10 px-3 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--text)]">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{description}</span>
      </span>
      <input
        checked={checked}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

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
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Закрыть настройки звука"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
        type="button"
      />

      <div className="absolute inset-0 flex items-start justify-center p-4 pt-20 md:justify-end md:p-6 md:pt-24">
        <aside className="audio-settings-panel w-full min-w-0 max-w-[420px] overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--panel)] shadow-[0_30px_80px_rgba(0,0,0,0.4)]">
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4 md:px-5">
            <div>
              <h3 className="text-base font-semibold text-[var(--text)]">Настройки звука</h3>
              <p className="text-sm text-[var(--muted)]">
                Микрофон, шумодав и обработка аудио.
              </p>
            </div>
            <button
              className="grid h-9 w-9 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]"
              onClick={onClose}
              type="button"
            >
              x
            </button>
          </div>

          <div className="voice-stage-scroll max-h-[calc(100vh-200px)] overflow-y-auto overflow-x-hidden px-4 py-4 md:max-h-[calc(100vh-240px)] md:px-5">
            <div className="grid min-w-0 gap-4">
              <section className="grid gap-2">
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
                  Микрофон
                </span>
                <label className="relative grid gap-2">
                  <select
                    className="h-11 w-full min-w-0 appearance-none rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] px-3 pr-10 text-sm text-[var(--text)] outline-none transition-colors duration-150 focus:border-[var(--accent)]"
                    onChange={(event) => setMicDeviceId(event.target.value)}
                    value={activeDeviceId}
                  >
                    {devices.length === 0 ? (
                      <option value={activeDeviceId}>Системный микрофон</option>
                    ) : null}
                    {devices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Микрофон ${device.deviceId.slice(0, 6)}`}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-[2.85rem] -translate-y-1/2 text-sm text-[var(--muted)]">
                    v
                  </span>
                </label>
              </section>

              <section className="grid gap-2">
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
                  Шумодав
                </span>
                <label className="relative grid gap-2">
                  <select
                    className="h-11 w-full min-w-0 appearance-none rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] px-3 pr-10 text-sm text-[var(--text)] outline-none transition-colors duration-150 focus:border-[var(--accent)]"
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
                  <span className="pointer-events-none absolute right-3 top-[2.85rem] -translate-y-1/2 text-sm text-[var(--muted)]">
                    v
                  </span>
                </label>
                <p className="text-xs leading-5 text-[var(--muted)]">
                  {activeLevel?.hint ?? 'Без дополнительной обработки.'}
                </p>
              </section>

              <section className="grid gap-3 rounded-3xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                <div>
                  <h4 className="text-sm font-medium text-[var(--text)]">Обработка аудио</h4>
                  <p className="text-xs leading-5 text-[var(--muted)]">
                    Настройки браузера и LiveKit для более чистого захвата голоса.
                  </p>
                </div>

                <ToggleRow
                  checked={capturePreferences.echoCancellation}
                  description="Убирает повторное эхо из динамиков и наушников."
                  label="Echo cancellation"
                  onChange={(checked) =>
                    setCapturePreferences({
                      ...capturePreferences,
                      echoCancellation: checked,
                    })
                  }
                />

                <ToggleRow
                  checked={capturePreferences.autoGainControl}
                  description="Автоматически подравнивает громкость микрофона."
                  label="Auto gain control"
                  onChange={(checked) =>
                    setCapturePreferences({
                      ...capturePreferences,
                      autoGainControl: checked,
                    })
                  }
                />

                <ToggleRow
                  checked={capturePreferences.noiseSuppression}
                  description="Встроенное подавление фонового шума от браузера."
                  label="Browser noise suppression"
                  onChange={(checked) =>
                    setCapturePreferences({
                      ...capturePreferences,
                      noiseSuppression: checked,
                    })
                  }
                />
              </section>

              <section className="rounded-3xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[var(--text)]">Уровень микрофона</span>
                  <span
                    className={`text-xs ${micSpeaking ? 'text-emerald-300' : 'text-[var(--muted)]'}`}
                  >
                    {micSpeaking ? 'Есть сигнал' : 'Тишина'}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-black/20">
                  <div
                    className={`h-full rounded-full transition-all ${
                      micSpeaking ? 'bg-emerald-400' : 'bg-[var(--accent)]'
                    }`}
                    style={{ width: `${Math.max(4, Math.min(100, micLevel * 100))}%` }}
                  />
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  Индикатор показывает текущий входной уровень после обработки.
                </p>
              </section>

              {remoteVolumes.length > 0 && (
                <section className="rounded-3xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-[var(--text)]">
                      Громкость участников
                    </span>
                    <span className="text-xs text-[var(--muted)]">0-200%</span>
                  </div>

                  <div className="grid min-w-0 gap-4">
                    {remoteVolumes.map((item) => (
                      <label className="grid min-w-0 gap-2" key={item.identity}>
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <span className="truncate text-sm text-[var(--text)]">{item.label}</span>
                          <span className="shrink-0 text-xs text-[var(--muted)]">
                            {item.value}%
                          </span>
                        </div>
                        <input
                          className="audio-slider w-full min-w-0 accent-[var(--accent)]"
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
                </section>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
