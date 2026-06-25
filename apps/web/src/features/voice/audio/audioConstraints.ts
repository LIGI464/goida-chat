import type { AudioCaptureOptions } from 'livekit-client';

export type NoiseSuppressionLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export interface VoiceCapturePreferences {
  micDeviceId: string;
  noiseSuppressionLevel: NoiseSuppressionLevel;
  echoCancellation: boolean;
  autoGainControl: boolean;
  noiseSuppression: boolean;
}

export const VOICE_STORAGE_KEYS = {
  micDeviceId: 'voice.micDeviceId',
  noiseSuppressionLevel: 'voice.noiseSuppressionLevel',
  echoCancellation: 'voice.echoCancellation',
  autoGainControl: 'voice.autoGainControl',
  noiseSuppression: 'voice.noiseSuppression',
} as const;

export const DEFAULT_VOICE_CAPTURE_PREFERENCES: VoiceCapturePreferences = {
  micDeviceId: 'default',
  noiseSuppressionLevel: 'medium',
  echoCancellation: true,
  autoGainControl: true,
  noiseSuppression: true,
};

export const NOISE_SUPPRESSION_LEVELS: Array<{
  hint: string;
  label: string;
  value: NoiseSuppressionLevel;
}> = [
  { value: 'off', label: 'Off', hint: 'Only browser DSP' },
  { value: 'low', label: 'Low', hint: 'Soft gate' },
  { value: 'medium', label: 'Medium', hint: 'Recommended' },
  { value: 'high', label: 'High', hint: 'Noisy room' },
  { value: 'max', label: 'Max', hint: 'Can clip voice' },
];

const isBrowser = typeof window !== 'undefined';

function readBoolean(key: string, fallback: boolean) {
  if (!isBrowser) return fallback;

  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;

  return raw === 'true';
}

function readString(key: string, fallback: string) {
  if (!isBrowser) return fallback;

  return window.localStorage.getItem(key) ?? fallback;
}

export function readVoiceCapturePreferences(): VoiceCapturePreferences {
  const noiseSuppressionLevel = readString(
    VOICE_STORAGE_KEYS.noiseSuppressionLevel,
    DEFAULT_VOICE_CAPTURE_PREFERENCES.noiseSuppressionLevel,
  ) as NoiseSuppressionLevel;

  return {
    micDeviceId: readString(
      VOICE_STORAGE_KEYS.micDeviceId,
      DEFAULT_VOICE_CAPTURE_PREFERENCES.micDeviceId,
    ),
    noiseSuppressionLevel,
    echoCancellation: readBoolean(
      VOICE_STORAGE_KEYS.echoCancellation,
      DEFAULT_VOICE_CAPTURE_PREFERENCES.echoCancellation,
    ),
    autoGainControl: readBoolean(
      VOICE_STORAGE_KEYS.autoGainControl,
      DEFAULT_VOICE_CAPTURE_PREFERENCES.autoGainControl,
    ),
    noiseSuppression: readBoolean(
      VOICE_STORAGE_KEYS.noiseSuppression,
      DEFAULT_VOICE_CAPTURE_PREFERENCES.noiseSuppression,
    ),
  };
}

export function writeVoiceCapturePreferences(
  next: Partial<VoiceCapturePreferences>,
  previous: VoiceCapturePreferences = DEFAULT_VOICE_CAPTURE_PREFERENCES,
) {
  if (!isBrowser) return;

  const merged: VoiceCapturePreferences = { ...previous, ...next };

  window.localStorage.setItem(VOICE_STORAGE_KEYS.micDeviceId, merged.micDeviceId);
  window.localStorage.setItem(
    VOICE_STORAGE_KEYS.noiseSuppressionLevel,
    merged.noiseSuppressionLevel,
  );
  window.localStorage.setItem(VOICE_STORAGE_KEYS.echoCancellation, String(merged.echoCancellation));
  window.localStorage.setItem(VOICE_STORAGE_KEYS.autoGainControl, String(merged.autoGainControl));
  window.localStorage.setItem(VOICE_STORAGE_KEYS.noiseSuppression, String(merged.noiseSuppression));
}

export interface NoiseGateConfig {
  attack: number;
  floor: number;
  holdMs: number;
  release: number;
  threshold: number;
}

const NOISE_GATE_CONFIGS: Record<Exclude<NoiseSuppressionLevel, 'off'>, NoiseGateConfig> = {
  low: {
    attack: 0.02,
    floor: 0.18,
    holdMs: 90,
    release: 0.15,
    threshold: 0.015,
  },
  medium: {
    attack: 0.018,
    floor: 0.12,
    holdMs: 120,
    release: 0.18,
    threshold: 0.02,
  },
  high: {
    attack: 0.014,
    floor: 0.07,
    holdMs: 160,
    release: 0.22,
    threshold: 0.028,
  },
  max: {
    attack: 0.01,
    floor: 0.03,
    holdMs: 220,
    release: 0.28,
    threshold: 0.035,
  },
};

export function getNoiseGateConfig(level: NoiseSuppressionLevel): NoiseGateConfig | null {
  if (level === 'off') return null;

  return NOISE_GATE_CONFIGS[level];
}

export function getVoiceActivityThreshold(level: NoiseSuppressionLevel) {
  const config = getNoiseGateConfig(level);
  return config ? config.threshold * 1.1 : 0.03;
}

export function buildAudioCaptureOptions(
  preferences: VoiceCapturePreferences,
): AudioCaptureOptions {
  const options: AudioCaptureOptions = {
    autoGainControl: preferences.autoGainControl,
    deviceId: preferences.micDeviceId || 'default',
    echoCancellation: preferences.echoCancellation,
    noiseSuppression: preferences.noiseSuppression,
  };

  if (preferences.noiseSuppression) {
    options.voiceIsolation = true;
  }

  return options;
}
