import { useEffect, useMemo, useState } from 'react';
import { LocalAudioTrack } from 'livekit-client';
import type { TrackPublication } from 'livekit-client';

import {
  readVoiceCapturePreferences,
  type NoiseSuppressionLevel,
  writeVoiceCapturePreferences,
} from './audioConstraints';
import { createLiveKitNoiseProcessor } from './noiseProcessors';

export function useNoiseSuppression(microphoneTrack: TrackPublication | undefined) {
  const [noiseSuppressionLevel, setNoiseSuppressionLevel] = useState<NoiseSuppressionLevel>(
    () => readVoiceCapturePreferences().noiseSuppressionLevel,
  );

  useEffect(() => {
    writeVoiceCapturePreferences({ noiseSuppressionLevel }, readVoiceCapturePreferences());
  }, [noiseSuppressionLevel]);

  const processor = useMemo(
    () => createLiveKitNoiseProcessor(noiseSuppressionLevel),
    [noiseSuppressionLevel],
  );

  useEffect(() => {
    const track = microphoneTrack?.audioTrack;
    if (!(track instanceof LocalAudioTrack)) return;

    const apply = async () => {
      try {
        if (!processor.isSupported() || noiseSuppressionLevel === 'off') {
          await track.stopProcessor();
          return;
        }

        await track.setProcessor(processor);
      } catch {
        await track.stopProcessor();
      }
    };

    void apply();

    return () => {
      void track.stopProcessor();
    };
  }, [microphoneTrack, noiseSuppressionLevel, processor]);

  return {
    noiseSuppressionLevel,
    setNoiseSuppressionLevel,
  };
}
