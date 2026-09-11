import { useEffect, useState } from 'react';
import { LocalAudioTrack } from 'livekit-client';
import type { TrackPublication } from 'livekit-client';

import type { NoiseSuppressionMode } from './audioConstraints';
import { NoiseProcessorSession } from './noiseProcessorSession';
import type { NoiseSuppressionRuntimeState } from './noiseProcessorSession';

export type { NoiseSuppressionRuntimeState } from './noiseProcessorSession';

export function useNoiseSuppression(
  microphoneTrack: TrackPublication | undefined,
  noiseSuppressionMode: NoiseSuppressionMode,
) {
  const [session] = useState(() => new NoiseProcessorSession());
  const [state, setState] = useState<NoiseSuppressionRuntimeState>({
    effectiveMode: noiseSuppressionMode === 'enhanced' ? 'browser' : noiseSuppressionMode,
    error: null,
  });
  const audioTrack = microphoneTrack?.audioTrack;
  const track = audioTrack instanceof LocalAudioTrack ? audioTrack : undefined;

  useEffect(() => {
    void session.update(track, noiseSuppressionMode, setState);
    return () => {
      // Coalesced with the next update for mode changes and React StrictMode replay.
      // On unmount it drains the queue and releases the owned processor.
      void session.update(undefined, 'off');
    };
  }, [session, track, noiseSuppressionMode]);

  return state;
}
