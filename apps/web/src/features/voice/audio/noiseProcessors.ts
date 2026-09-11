import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';
import { Track } from 'livekit-client';

import type { NoiseSuppressionMode } from './audioConstraints';

export interface NoiseProcessor {
  isSupported(): boolean;
  createProcessedTrack(
    inputTrack: MediaStreamTrack,
    audioContext?: AudioContext,
  ): Promise<MediaStreamTrack>;
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
const workletLoadPromises = new WeakMap<AudioContext, Promise<void>>();

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

function loadWorklet(audioContext: AudioContext, workletUrl: string) {
  const existingPromise = workletLoadPromises.get(audioContext);
  if (existingPromise) {
    return existingPromise;
  }

  const loadPromise = audioContext.audioWorklet.addModule(workletUrl).catch((error) => {
    workletLoadPromises.delete(audioContext);
    throw error;
  });
  workletLoadPromises.set(audioContext, loadPromise);
  return loadPromise;
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
  #generation = 0;
  #processedTrack: MediaStreamTrack | null = null;
  #rnnoiseNode: AudioWorkletNode | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #inputTrack: MediaStreamTrack | null = null;

  isSupported() {
    return supportsEnhancedNoiseSuppression();
  }

  async createProcessedTrack(inputTrack: MediaStreamTrack, audioContext?: AudioContext) {
    if (!audioContext || audioContext.state === 'closed') {
      throw new Error('LiveKit did not provide a usable AudioContext for noise suppression.');
    }
    if (!this.isSupported() || audioContext.sampleRate !== 48_000) {
      throw new Error('RNNoise requires AudioWorklet and a 48kHz audio context.');
    }

    const generation = ++this.#generation;
    // A device restart replaces only the source. Keep the output identity used by the sender.
    if (
      this.#audioContext === audioContext &&
      this.#processedTrack?.readyState === 'live' &&
      this.#rnnoiseNode
    ) {
      if (this.#inputTrack !== inputTrack) {
        const source = audioContext.createMediaStreamSource(new MediaStream([inputTrack]));
        try {
          source.connect(this.#rnnoiseNode);
        } catch (error) {
          source.disconnect();
          throw error;
        }
        this.#source?.disconnect();
        this.#source = source;
        this.#inputTrack = inputTrack;
      }
      return this.#processedTrack;
    }
    this.#destroyGraph();

    let source: MediaStreamAudioSourceNode | null = null;
    let destination: MediaStreamAudioDestinationNode | null = null;
    let rnnoiseNode: AudioWorkletNode | null = null;

    try {
      // LiveKit owns context resume/close. In particular, do not wait on a suspended
      // context here: autoplay restrictions must not block the track-change lock.
      const [assets, wasmBinary] = await Promise.all([
        loadEnhancedProcessorAssets(),
        loadRnnoiseBinary(),
      ]);

      await loadWorklet(audioContext, assets.workletUrl);
      if (generation !== this.#generation) {
        throw new Error('Noise suppression processor initialization was superseded.');
      }

      source = audioContext.createMediaStreamSource(new MediaStream([inputTrack]));
      destination = audioContext.createMediaStreamDestination();
      rnnoiseNode = new assets.RnnoiseWorkletNode(audioContext, {
        maxChannels: 2,
        wasmBinary,
      });

      source.connect(rnnoiseNode);
      rnnoiseNode.connect(destination);

      const outputTrack = destination.stream.getAudioTracks()[0];
      if (!outputTrack) {
        throw new Error('Enhanced noise suppression produced no output track.');
      }

      this.#audioContext = audioContext;
      this.#inputTrack = inputTrack;
      this.#source = source;
      this.#destination = destination;
      this.#rnnoiseNode = rnnoiseNode;
      this.#processedTrack = outputTrack;

      return outputTrack;
    } catch (error) {
      this.#destroyNodes(source, destination, rnnoiseNode);
      if (generation === this.#generation) {
        this.#destroyGraph();
      }
      throw error;
    }
  }

  destroy() {
    this.#generation += 1;
    this.#destroyGraph();
  }

  #destroyNodes(
    source: MediaStreamAudioSourceNode | null,
    destination: MediaStreamAudioDestinationNode | null,
    rnnoiseNode: AudioWorkletNode | null,
  ) {
    destination?.stream.getTracks().forEach((track) => track.stop());

    const destroyableNode = rnnoiseNode as (AudioWorkletNode & { destroy?: () => void }) | null;
    destroyableNode?.destroy?.();
    destroyableNode?.disconnect();
    destroyableNode?.port.close();

    source?.disconnect();
    destination?.disconnect();
  }

  #destroyGraph() {
    this.#destroyNodes(this.#source, this.#destination, this.#rnnoiseNode);
    this.#processedTrack = null;
    this.#rnnoiseNode = null;
    this.#source = null;
    this.#destination = null;
    this.#audioContext = null;
    this.#inputTrack = null;
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

export class LiveKitNoiseProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  name: string;
  processedTrack?: MediaStreamTrack;
  #processor: NoiseProcessor;
  #operation: Promise<void> = Promise.resolve();
  #audioContext: AudioContext | undefined;
  #generation = 0;
  #active = false;

  constructor(processor: NoiseProcessor) {
    this.#processor = processor;
    this.name = processor.constructor.name;
  }

  isSupported() {
    return this.#processor.isSupported();
  }

  init(opts: AudioProcessorOptions) {
    const generation = this.#generation;
    return this.#enqueue(async () => {
      if (generation !== this.#generation) throw new Error('Processor initialization cancelled.');
      this.#destroyCurrent();
      this.#audioContext = opts.audioContext;
      try {
        await this.#process(opts.track, generation);
        this.#active = true;
      } catch (error) {
        this.#destroyCurrent();
        throw error;
      }
    });
  }

  restart(opts: AudioProcessorOptions) {
    const generation = this.#generation;
    return this.#enqueue(async () => {
      if (!this.#active || generation !== this.#generation) return;
      // LiveKit 2.x omits audioContext from LocalTrack.setMediaStreamTrack's restart.
      this.#audioContext = opts.audioContext ?? this.#audioContext;
      try {
        await this.#process(opts.track, generation);
      } catch (error) {
        this.#destroyCurrent();
        throw error;
      }
    });
  }

  destroy() {
    this.#generation += 1;
    this.#active = false;
    // Invalidate pending asset loading immediately; queued restarts cannot revive it.
    this.#destroyCurrent();
    return this.#enqueue(async () => {
      this.#destroyCurrent();
    });
  }

  async #process(input: MediaStreamTrack, generation: number) {
    const output = await this.#processor.createProcessedTrack(input, this.#audioContext);
    if (generation !== this.#generation) {
      this.#processor.destroy();
      throw new Error('Processor initialization cancelled.');
    }
    // LiveKit stops processedTrack on detach. Never expose the borrowed input as output.
    if (output !== input) this.processedTrack = output;
    else delete this.processedTrack;
  }

  #enqueue<T>(operation: () => Promise<T>) {
    const next = this.#operation.then(operation, operation);
    this.#operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  #destroyCurrent() {
    delete this.processedTrack;
    this.#audioContext = undefined;
    this.#active = false;
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
