import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';
import { Track } from 'livekit-client';

import type { NoiseSuppressionMode } from './audioConstraints';

export interface NoiseProcessor {
  isSupported(): boolean;
  createProcessedTrack(inputTrack: MediaStreamTrack): Promise<MediaStreamTrack>;
  destroy(): void;
}

type RnnoiseModule = typeof import('@sapphi-red/web-noise-suppressor');
type AudioContextConstructor = typeof AudioContext;
type EnhancedProcessorAssets = {
  RnnoiseWorkletNode: RnnoiseModule['RnnoiseWorkletNode'];
  loadRnnoise: RnnoiseModule['loadRnnoise'];
  rnnoiseSimdWasmUrl: string;
  rnnoiseWasmUrl: string;
  workletUrl: string;
};

let enhancedProcessorAssetsPromise: Promise<EnhancedProcessorAssets> | null = null;
let rnnoiseBinaryPromise: Promise<ArrayBuffer> | null = null;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;

  const audioWindow = window as Window &
    typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

async function loadEnhancedProcessorAssets() {
  if (!enhancedProcessorAssetsPromise) {
    enhancedProcessorAssetsPromise = Promise.all([
      import('@sapphi-red/web-noise-suppressor'),
      import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
      import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
      import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'),
    ])
      .then(([module, workletUrlModule, wasmUrlModule, simdWasmUrlModule]) => ({
        RnnoiseWorkletNode: module.RnnoiseWorkletNode,
        loadRnnoise: module.loadRnnoise,
        rnnoiseSimdWasmUrl: simdWasmUrlModule.default,
        rnnoiseWasmUrl: wasmUrlModule.default,
        workletUrl: workletUrlModule.default,
      }))
      .catch((error) => {
        enhancedProcessorAssetsPromise = null;
        throw error;
      });
  }

  return enhancedProcessorAssetsPromise;
}

async function loadRnnoiseBinary() {
  if (!rnnoiseBinaryPromise) {
    rnnoiseBinaryPromise = loadEnhancedProcessorAssets()
      .then((assets) =>
        assets.loadRnnoise({
          simdUrl: assets.rnnoiseSimdWasmUrl,
          url: assets.rnnoiseWasmUrl,
        }),
      )
      .catch((error) => {
        rnnoiseBinaryPromise = null;
        throw error;
      });
  }

  return rnnoiseBinaryPromise;
}

export function supportsEnhancedNoiseSuppression() {
  const AudioContextCtor = getAudioContextConstructor();

  return (
    typeof window !== 'undefined' &&
    AudioContextCtor !== null &&
    typeof AudioWorkletNode !== 'undefined' &&
    'audioWorklet' in AudioContextCtor.prototype
  );
}

export class EnhancedNoiseProcessor implements NoiseProcessor {
  #audioContext: AudioContext | null = null;
  #destination: MediaStreamAudioDestinationNode | null = null;
  #processedTrack: MediaStreamTrack | null = null;
  #rnnoiseNode: AudioWorkletNode | null = null;
  #source: MediaStreamAudioSourceNode | null = null;

  isSupported() {
    return supportsEnhancedNoiseSuppression();
  }

  async createProcessedTrack(inputTrack: MediaStreamTrack) {
    if (!this.isSupported()) {
      return inputTrack;
    }

    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) {
      return inputTrack;
    }

    try {
      const channelCount = Math.max(1, Math.min(2, inputTrack.getSettings().channelCount ?? 1));
      const audioContext = new AudioContextCtor({
        latencyHint: 'interactive',
        sampleRate: 48_000,
      });

      this.#audioContext = audioContext;
      await audioContext.resume().catch(() => undefined);

      if (audioContext.sampleRate !== 48_000) {
        throw new Error('RNNoise requires a 48kHz audio context.');
      }

      const [assets, wasmBinary] = await Promise.all([
        loadEnhancedProcessorAssets(),
        loadRnnoiseBinary(),
      ]);

      await audioContext.audioWorklet.addModule(assets.workletUrl);

      const source = audioContext.createMediaStreamSource(new MediaStream([inputTrack]));
      const destination = audioContext.createMediaStreamDestination();
      const rnnoiseNode = new assets.RnnoiseWorkletNode(audioContext, {
        maxChannels: channelCount,
        wasmBinary,
      });

      source.connect(rnnoiseNode);
      rnnoiseNode.connect(destination);

      const outputTrack = destination.stream.getAudioTracks()[0];
      if (!outputTrack) {
        throw new Error('Enhanced noise suppression produced no output track.');
      }

      this.#source = source;
      this.#destination = destination;
      this.#rnnoiseNode = rnnoiseNode;
      this.#processedTrack = outputTrack;

      return outputTrack;
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  destroy() {
    this.#processedTrack?.stop();
    this.#processedTrack = null;

    const rnnoiseNode = this.#rnnoiseNode as (AudioWorkletNode & { destroy?: () => void }) | null;
    rnnoiseNode?.destroy?.();
    rnnoiseNode?.disconnect();
    this.#rnnoiseNode = null;

    this.#source?.disconnect();
    this.#source = null;

    this.#destination?.disconnect();
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

class LiveKitNoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name: string;
  processedTrack?: MediaStreamTrack;
  #inputTrack: MediaStreamTrack | null = null;
  #processor: NoiseProcessor;

  constructor(processor: NoiseProcessor) {
    this.#processor = processor;
    this.name = processor.constructor.name;
  }

  isSupported() {
    return this.#processor.isSupported();
  }

  async init(opts: AudioProcessorOptions) {
    this.#inputTrack = opts.track;
    this.processedTrack = await this.#processor.createProcessedTrack(opts.track);
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    this.#inputTrack = opts.track;
    this.processedTrack = await this.#processor.createProcessedTrack(opts.track);
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

export function createNoiseProcessor(mode: NoiseSuppressionMode) {
  if (mode !== 'enhanced') {
    return new NoopNoiseProcessor();
  }

  return new EnhancedNoiseProcessor();
}

export function createLiveKitNoiseProcessor(mode: NoiseSuppressionMode) {
  return new LiveKitNoiseProcessor(createNoiseProcessor(mode));
}
