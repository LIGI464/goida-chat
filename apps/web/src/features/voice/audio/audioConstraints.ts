import type { AudioCaptureOptions } from 'livekit-client';

export type NoiseSuppressionMode = 'off' | 'browser' | 'enhanced';

export interface VoiceCapturePreferences {
  micDeviceId: string;
  noiseSuppressionMode: NoiseSuppressionMode;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

export const VOICE_STORAGE_KEYS = {
  micDeviceId: 'voice.micDeviceId',
  noiseSuppressionMode: 'voice.noiseSuppressionMode',
  legacyNoiseSuppressionLevel: 'voice.noiseSuppressionLevel',
  echoCancellation: 'voice.echoCancellation',
  autoGainControl: 'voice.autoGainControl',
  legacyNoiseSuppression: 'voice.noiseSuppression',
} as const;

export const DEFAULT_VOICE_CAPTURE_PREFERENCES: VoiceCapturePreferences = {
  micDeviceId: 'default',
  noiseSuppressionMode: 'browser',
  echoCancellation: true,
  autoGainControl: true,
};

export const NOISE_SUPPRESSION_MODES: Array<{
  hint: string;
  label: string;
  value: NoiseSuppressionMode;
}> = [
  {
    value: 'off',
    label: 'Off',
    hint: 'Only the raw microphone signal is published.',
  },
  {
    value: 'browser',
    label: 'Browser',
    hint: 'Uses browser capture cleanup with echo cancellation, AGC, and noise suppression.',
  },
  {
    value: 'enhanced',
    label: 'Enhanced',
    hint: 'Adds RNNoise processing on top of browser cleanup when AudioWorklet is available.',
  },
];

const LEGACY_ENHANCED_LEVELS = new Set(['high', 'max']);
const LEGACY_BROWSER_LEVELS = new Set(['low', 'medium']);
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

function normalizeNoiseSuppressionMode(raw: string | null): NoiseSuppressionMode {
  if (raw === 'off' || raw === 'browser' || raw === 'enhanced') {
    return raw;
  }

  if (!raw) {
    return DEFAULT_VOICE_CAPTURE_PREFERENCES.noiseSuppressionMode;
  }

  if (LEGACY_ENHANCED_LEVELS.has(raw)) {
    return 'enhanced';
  }

  if (LEGACY_BROWSER_LEVELS.has(raw)) {
    return 'browser';
  }

  return raw === 'off' ? 'off' : DEFAULT_VOICE_CAPTURE_PREFERENCES.noiseSuppressionMode;
}

function readNoiseSuppressionMode() {
  if (!isBrowser) {
    return DEFAULT_VOICE_CAPTURE_PREFERENCES.noiseSuppressionMode;
  }

  const raw =
    window.localStorage.getItem(VOICE_STORAGE_KEYS.noiseSuppressionMode) ??
    window.localStorage.getItem(VOICE_STORAGE_KEYS.legacyNoiseSuppressionLevel);

  return normalizeNoiseSuppressionMode(raw);
}

export function readVoiceCapturePreferences(): VoiceCapturePreferences {
  return {
    micDeviceId: readString(
      VOICE_STORAGE_KEYS.micDeviceId,
      DEFAULT_VOICE_CAPTURE_PREFERENCES.micDeviceId,
    ),
    noiseSuppressionMode: readNoiseSuppressionMode(),
    echoCancellation: readBoolean(
      VOICE_STORAGE_KEYS.echoCancellation,
      DEFAULT_VOICE_CAPTURE_PREFERENCES.echoCancellation,
    ),
    autoGainControl: readBoolean(
      VOICE_STORAGE_KEYS.autoGainControl,
      DEFAULT_VOICE_CAPTURE_PREFERENCES.autoGainControl,
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
    VOICE_STORAGE_KEYS.noiseSuppressionMode,
    merged.noiseSuppressionMode,
  );
  window.localStorage.setItem(VOICE_STORAGE_KEYS.echoCancellation, String(merged.echoCancellation));
  window.localStorage.setItem(VOICE_STORAGE_KEYS.autoGainControl, String(merged.autoGainControl));
  window.localStorage.removeItem(VOICE_STORAGE_KEYS.legacyNoiseSuppression);
}

export function supportsVoiceIsolationConstraint() {
  if (!isBrowser || !navigator.mediaDevices?.getSupportedConstraints) {
    return false;
  }

  const supportedConstraints = navigator.mediaDevices.getSupportedConstraints() as
    MediaTrackSupportedConstraints & {
      voiceIsolation?: boolean;
    };

  return supportedConstraints.voiceIsolation === true;
}

export function isBrowserNoiseCleanupEnabled(mode: NoiseSuppressionMode) {
  return mode !== 'off';
}

export function getVoiceActivityThreshold(mode: NoiseSuppressionMode) {
  switch (mode) {
    case 'enhanced':
      return 0.02;
    case 'browser':
      return 0.025;
    case 'off':
    default:
      return 0.03;
  }
}

export function buildAudioCaptureOptions(
  preferences: VoiceCapturePreferences,
): AudioCaptureOptions {
  const browserNoiseCleanupEnabled = isBrowserNoiseCleanupEnabled(
    preferences.noiseSuppressionMode,
  );
  const options: AudioCaptureOptions = {
    autoGainControl: browserNoiseCleanupEnabled ? true : preferences.autoGainControl,
    deviceId: preferences.micDeviceId || 'default',
    echoCancellation: browserNoiseCleanupEnabled ? true : preferences.echoCancellation,
    noiseSuppression: browserNoiseCleanupEnabled,
  };

  if (browserNoiseCleanupEnabled && supportsVoiceIsolationConstraint()) {
    options.voiceIsolation = true;
  }

  return options;
}
