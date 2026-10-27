import { useEffect, useMemo, useState } from 'react';

import { getVoiceActivityThreshold, type NoiseSuppressionMode } from './audioConstraints';

export function useAudioLevelMeter(
  track: MediaStreamTrack | null | undefined,
  mode: NoiseSuppressionMode,
) {
  const [meter, setMeter] = useState(0);

  const threshold = useMemo(() => getVoiceActivityThreshold(mode), [mode]);

  useEffect(() => {
    if (!track) {
      setMeter(0);
      return;
    }

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    const analyser = audioContext.createAnalyser();
    const samples = new Uint8Array(1024);
    analyser.fftSize = samples.length;
    source.connect(analyser);

    let frame = 0;
    let alive = true;

    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;

      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }

      const rms = Math.sqrt(sum / samples.length);
      setMeter(rms);

      if (alive) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    void audioContext.resume().catch(() => undefined);
    frame = window.requestAnimationFrame(tick);

    return () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close().catch(() => undefined);
    };
  }, [track]);

  return {
    level: meter,
    speaking: meter >= threshold,
  };
}
