import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';
import { Track } from 'livekit-client';

import { getNoiseGateConfig, type NoiseSuppressionLevel } from './audioConstraints';

export interface NoiseProcessor {
  isSupported(): boolean;
  createProcessedTrack(
    inputTrack: MediaStreamTrack,
    level: NoiseSuppressionLevel,
  ): Promise<MediaStreamTrack>;
  destroy(): void;
}

function getRms(samples: Uint8Array) {
  let sum = 0;

  for (const sample of samples) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }

  return Math.sqrt(sum / samples.length);
}

export class BrowserNoiseProcessor implements NoiseProcessor {
  #audioContext: AudioContext | null = null;
  #analyser: AnalyserNode | null = null;
  #destination: MediaStreamAudioDestinationNode | null = null;
  #gain: GainNode | null = null;
  #rafId = 0;
  #source: MediaStreamAudioSourceNode | null = null;
  #stopped = false;
  #processedTrack: MediaStreamTrack | null = null;

  isSupported() {
    return typeof window !== 'undefined' && typeof window.AudioContext !== 'undefined';
  }

  async createProcessedTrack(inputTrack: MediaStreamTrack, level: NoiseSuppressionLevel) {
    const config = getNoiseGateConfig(level);
    if (!config || !this.isSupported()) return inputTrack;

    const audioContext = new AudioContext();
    this.#audioContext = audioContext;
    await audioContext.resume().catch(() => undefined);

    const sourceStream = new MediaStream([inputTrack]);
    this.#source = audioContext.createMediaStreamSource(sourceStream);
    this.#analyser = audioContext.createAnalyser();
    this.#gain = audioContext.createGain();
    this.#destination = audioContext.createMediaStreamDestination();
    this.#analyser.fftSize = 1024;
    this.#gain.gain.value = 1;

    this.#source.connect(this.#analyser);
    this.#analyser.connect(this.#gain);
    this.#gain.connect(this.#destination);

    const outputTrack = this.#destination.stream.getAudioTracks()[0];
    if (!outputTrack) return inputTrack;

    this.#processedTrack = outputTrack;
    this.#stopped = false;

    const samples = new Uint8Array(this.#analyser.fftSize);
    let openedUntil = 0;
    let smoothedGain = 1;

    const tick = () => {
      if (
        this.#stopped ||
        !this.#audioContext ||
        !this.#analyser ||
        !this.#gain ||
        !this.#destination
      ) {
        return;
      }

      this.#analyser.getByteTimeDomainData(samples);
      const rms = getRms(samples);
      const speaking = rms >= config.threshold;
      const now = performance.now();

      if (speaking) {
        openedUntil = now + config.holdMs;
      }

      const open = now <= openedUntil;
      const targetGain = open
        ? 1
        : config.floor +
          Math.min(1, Math.max(0, (rms - config.threshold) / config.threshold)) *
            (1 - config.floor);

      smoothedGain += (targetGain - smoothedGain) * (open ? config.attack : config.release);
      this.#gain.gain.setTargetAtTime(
        smoothedGain,
        this.#audioContext.currentTime,
        open ? config.attack : config.release,
      );

      this.#rafId = window.requestAnimationFrame(tick);
    };

    this.#rafId = window.requestAnimationFrame(tick);
    return outputTrack;
  }

  destroy() {
    this.#stopped = true;
    if (this.#rafId) {
      window.cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }

    this.#processedTrack?.stop();
    this.#processedTrack = null;
    this.#source?.disconnect();
    this.#analyser?.disconnect();
    this.#gain?.disconnect();
    this.#destination?.disconnect();
    this.#source = null;
    this.#analyser = null;
    this.#gain = null;
    this.#destination = null;

    void this.#audioContext?.close().catch(() => undefined);
    this.#audioContext = null;
  }
}

export class NoopNoiseProcessor implements NoiseProcessor {
  isSupported() {
    return true;
  }

  async createProcessedTrack(inputTrack: MediaStreamTrack) {
    return inputTrack;
  }

  destroy() {}
}

export class RnnoiseProcessor extends BrowserNoiseProcessor {
  override isSupported() {
    return false;
  }
}

class LiveKitNoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name: string;
  processedTrack?: MediaStreamTrack;
  #level: NoiseSuppressionLevel;
  #processor: NoiseProcessor;
  #inputTrack: MediaStreamTrack | null = null;

  constructor(processor: NoiseProcessor, level: NoiseSuppressionLevel) {
    this.#processor = processor;
    this.#level = level;
    this.name = processor.constructor.name;
  }

  isSupported() {
    return this.#processor.isSupported();
  }

  async init(opts: AudioProcessorOptions) {
    this.#inputTrack = opts.track;
    this.processedTrack = await this.#processor.createProcessedTrack(opts.track, this.#level);
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    this.#inputTrack = opts.track;
    this.processedTrack = await this.#processor.createProcessedTrack(opts.track, this.#level);
  }

  async destroy() {
    if (this.processedTrack && this.processedTrack !== this.#inputTrack) {
      this.processedTrack.stop();
    }

    delete this.processedTrack;
    this.#inputTrack = null;
    this.#processor.destroy();
  }
}

export function createNoiseProcessor(level: NoiseSuppressionLevel) {
  if (level === 'off') return new NoopNoiseProcessor();

  const rnnoise = new RnnoiseProcessor();
  if (rnnoise.isSupported()) return rnnoise;

  return new BrowserNoiseProcessor();
}

export function createLiveKitNoiseProcessor(level: NoiseSuppressionLevel) {
  return new LiveKitNoiseProcessor(createNoiseProcessor(level), level);
}
