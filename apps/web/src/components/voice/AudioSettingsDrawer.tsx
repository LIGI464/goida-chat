import { useEffect } from 'react';

import {
  NOISE_SUPPRESSION_MODES,
  type NoiseSuppressionMode,
  type VoiceCapturePreferences,
} from '../../features/voice/audio/audioConstraints';
import { supportsEnhancedNoiseSuppression } from '../../features/voice/audio/noiseProcessors';
import type { NoiseSuppressionRuntimeState } from '../../features/voice/audio/useNoiseSuppression';
import {
  MAX_VOICE_PEER_VOLUME,
  MIN_VOICE_PEER_VOLUME,
} from '../../features/voice/audio/usePersistentPeerVolumes';

function SelectChevron() {
  return (
    <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[var(--muted)]">
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 16 16"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M4 6.25 8 10.25l4-4"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    </span>
  );
}

function ToggleRow({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-[22px] border border-[var(--border)] bg-black/10 px-3 py-3 ${
        disabled ? 'opacity-70' : ''
      }`}
    >
      <span className="min-w-0 pr-1">
        <span className="block text-sm font-medium text-[var(--text)]">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{description}</span>
      </span>
      <input
        checked={checked}
        className="mt-1 h-4 w-4 shrink-0 self-start accent-[var(--accent)]"
        disabled={disabled}
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
  noiseSuppressionMode,
  noiseSuppressionState,
  setNoiseSuppressionMode,
  micLevel,
  micSpeaking,
  remoteVolumes,
  onRemoteVolumeChange,
}: {
  activeDeviceId: string;
  devices: MediaDeviceInfo[];
  open: boolean;
  onClose: () => void;
  capturePreferences: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionMode'>;
  setCapturePreferences: (
    next: Omit<VoiceCapturePreferences, 'micDeviceId' | 'noiseSuppressionMode'>,
  ) => void;
  setMicDeviceId: (next: string) => void;
  noiseSuppressionMode: NoiseSuppressionMode;
  noiseSuppressionState: NoiseSuppressionRuntimeState;
  setNoiseSuppressionMode: (next: NoiseSuppressionMode) => void;
  micLevel: number;
  micSpeaking: boolean;
  remoteVolumes: Array<{ remoteUserId: string; label: string; value: number }>;
  onRemoteVolumeChange: (remoteUserId: string, nextValue: number) => void;
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

  const activeMode = NOISE_SUPPRESSION_MODES.find((mode) => mode.value === noiseSuppressionMode);
  const enhancedAvailable = supportsEnhancedNoiseSuppression();
  const enhancedFallback =
    noiseSuppressionMode === 'enhanced' && noiseSuppressionState.effectiveMode !== 'enhanced';
  const browserCleanupLocked = noiseSuppressionMode !== 'off';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-4 md:items-center md:justify-end md:p-6">
      <button
        aria-label="Закрыть настройки звука"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
        type="button"
      />

      <aside
        aria-modal="true"
        className="audio-settings-panel relative z-10 flex max-h-[85vh] w-[min(90vw,480px)] min-w-0 max-w-[520px] flex-col overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--panel)] shadow-[0_30px_80px_rgba(0,0,0,0.4)]"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4 md:px-5">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--text)]">Настройки звука</h3>
            <p className="text-sm text-[var(--muted)]">
              Микрофон, шумодав и обработка аудио.
            </p>
          </div>
          <button
            aria-label="Закрыть"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]"
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </div>

        <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 md:px-5">
          <div className="grid min-w-0 gap-4">
            <section className="grid gap-2">
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
                Микрофон
              </span>
              <label className="relative block">
                <select
                  className="h-11 w-full min-w-0 appearance-none rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] px-3 pr-11 text-sm leading-5 text-[var(--text)] outline-none transition-colors duration-150 focus:border-[var(--accent)]"
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
                <SelectChevron />
              </label>
            </section>

            <section className="grid gap-2">
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
                Шумодав
              </span>
              <label className="relative block">
                <select
                  className="h-11 w-full min-w-0 appearance-none rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] px-3 pr-11 text-sm leading-5 text-[var(--text)] outline-none transition-colors duration-150 focus:border-[var(--accent)]"
                  onChange={(event) =>
                    setNoiseSuppressionMode(event.target.value as NoiseSuppressionMode)
                  }
                  value={noiseSuppressionMode}
                >
                  {NOISE_SUPPRESSION_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </label>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full border border-[var(--border)] bg-black/10 px-2.5 py-1 text-[var(--text)]">
                  {activeMode?.label ?? 'Off'}
                </span>
                {!enhancedAvailable && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-100">
                    Усиленный режим недоступен в этом браузере
                  </span>
                )}
                {enhancedFallback && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-100">
                    Используется браузерный fallback
                  </span>
                )}
              </div>
              <p className="text-xs leading-5 text-[var(--muted)]">
                {noiseSuppressionState.error ??
                  activeMode?.hint ??
                  'Дополнительная обработка не используется.'}
              </p>
            </section>

            <section className="grid gap-3 rounded-[24px] border border-[var(--border)] bg-[var(--panel-2)] p-4">
              <div>
                <h4 className="text-sm font-medium text-[var(--text)]">Браузерные capture constraints</h4>
                <p className="text-xs leading-5 text-[var(--muted)]">
                  {browserCleanupLocked
                    ? 'В режимах Browser и Enhanced echo cancellation, auto gain control и noise suppression включаются автоматически.'
                    : 'В режиме Off можно отдельно включать базовую браузерную обработку микрофона.'}
                </p>
              </div>

              <ToggleRow
                checked={browserCleanupLocked ? true : capturePreferences.echoCancellation}
                description="Убирает повторное эхо из динамиков и наушников."
                disabled={browserCleanupLocked}
                label="Echo cancellation"
                onChange={(checked) =>
                  setCapturePreferences({
                    ...capturePreferences,
                    echoCancellation: checked,
                  })
                }
              />

              <ToggleRow
                checked={browserCleanupLocked ? true : capturePreferences.autoGainControl}
                description="Автоматически подравнивает громкость микрофона."
                disabled={browserCleanupLocked}
                label="Auto gain control"
                onChange={(checked) =>
                  setCapturePreferences({
                    ...capturePreferences,
                    autoGainControl: checked,
                  })
                }
              />
            </section>

            <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel-2)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-[var(--text)]">Уровень микрофона</span>
                <span
                  className={`shrink-0 text-xs ${micSpeaking ? 'text-emerald-300' : 'text-[var(--muted)]'}`}
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
                Индикатор показывает текущий входной уровень после активной обработки.
              </p>
            </section>

            {remoteVolumes.length > 0 && (
              <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel-2)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[var(--text)]">
                    Громкость участников
                  </span>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {MIN_VOICE_PEER_VOLUME}-{MAX_VOICE_PEER_VOLUME}%
                  </span>
                </div>

                <div className="grid min-w-0 gap-4">
                  {remoteVolumes.map((item) => (
                    <label className="grid min-w-0 gap-2" key={item.remoteUserId}>
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="truncate text-sm text-[var(--text)]">{item.label}</span>
                        <span className="shrink-0 text-xs text-[var(--muted)]">
                          {item.value}%
                        </span>
                      </div>
                      <input
                        className="audio-slider w-full min-w-0 accent-[var(--accent)]"
                        max={MAX_VOICE_PEER_VOLUME}
                        min={MIN_VOICE_PEER_VOLUME}
                        onChange={(event) =>
                          onRemoteVolumeChange(item.remoteUserId, Number(event.target.value))
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
  );
}
