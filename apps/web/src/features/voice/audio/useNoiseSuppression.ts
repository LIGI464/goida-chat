import { useEffect, useMemo, useState } from 'react';
import { LocalAudioTrack } from 'livekit-client';
import type { TrackPublication } from 'livekit-client';

import type { NoiseSuppressionMode } from './audioConstraints';
import {
  createLiveKitNoiseProcessor,
  supportsEnhancedNoiseSuppression,
} from './noiseProcessors';

export interface NoiseSuppressionRuntimeState {
  effectiveMode: NoiseSuppressionMode;
  error: string | null;
}

const ENHANCED_UNAVAILABLE_MESSAGE =
  'Усиленный шумодав недоступен в этом браузере. Используем браузерную обработку.';
const ENHANCED_FAILED_MESSAGE =
  'Не удалось запустить усиленный шумодав. Используем браузерную обработку.';

export function useNoiseSuppression(
  microphoneTrack: TrackPublication | undefined,
  noiseSuppressionMode: NoiseSuppressionMode,
) {
  const [state, setState] = useState<NoiseSuppressionRuntimeState>({
    effectiveMode: noiseSuppressionMode,
    error: null,
  });
  const processor = useMemo(
    () => createLiveKitNoiseProcessor(noiseSuppressionMode),
    [noiseSuppressionMode],
  );

  useEffect(() => {
    if (noiseSuppressionMode !== 'enhanced') {
      setState({
        effectiveMode: noiseSuppressionMode,
        error: null,
      });
      return;
    }

    if (!supportsEnhancedNoiseSuppression()) {
      setState({
        effectiveMode: 'browser',
        error: ENHANCED_UNAVAILABLE_MESSAGE,
      });
      return;
    }

    setState({
      effectiveMode: 'browser',
      error: null,
    });
  }, [noiseSuppressionMode]);

  useEffect(() => {
    const track = microphoneTrack?.audioTrack;
    if (!(track instanceof LocalAudioTrack)) {
      return;
    }

    let cancelled = false;

    const apply = async () => {
      if (noiseSuppressionMode !== 'enhanced') {
        await track.stopProcessor();
        if (!cancelled) {
          setState({
            effectiveMode: noiseSuppressionMode,
            error: null,
          });
        }
        return;
      }

      if (!processor.isSupported()) {
        await track.stopProcessor();
        if (!cancelled) {
          setState({
            effectiveMode: 'browser',
            error: ENHANCED_UNAVAILABLE_MESSAGE,
          });
        }
        return;
      }

      try {
        await track.setProcessor(processor);
        if (!cancelled) {
          setState({
            effectiveMode: 'enhanced',
            error: null,
          });
        }
      } catch {
        await track.stopProcessor();
        if (!cancelled) {
          setState({
            effectiveMode: 'browser',
            error: ENHANCED_FAILED_MESSAGE,
          });
        }
      }
    };

    void apply();

    return () => {
      cancelled = true;
      void track.stopProcessor();
    };
  }, [microphoneTrack, noiseSuppressionMode, processor]);

  return state;
}
