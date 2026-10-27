import type { LocalAudioTrack } from 'livekit-client';

import type { NoiseSuppressionMode } from './audioConstraints';
import { createLiveKitNoiseProcessor, supportsEnhancedNoiseSuppression } from './noiseProcessors';
import type { LiveKitNoiseProcessor } from './noiseProcessors';

export interface NoiseSuppressionRuntimeState {
  effectiveMode: NoiseSuppressionMode;
  error: string | null;
}

type ProcessorTrack = Pick<LocalAudioTrack, 'getProcessor' | 'setProcessor' | 'stopProcessor'>;
const UNAVAILABLE =
  'Усиленный шумодав недоступен в этом браузере. Используем браузерную обработку.';
const FAILED = 'Не удалось запустить усиленный шумодав. Используем браузерную обработку.';

// Shared per-track ordering also covers a rapid unmount/remount of the voice bridge.
const trackOperations = new WeakMap<ProcessorTrack, Promise<void>>();

function withTrack(track: ProcessorTrack, operation: () => Promise<void>) {
  const next = (trackOperations.get(track) ?? Promise.resolve()).then(operation);
  trackOperations.set(
    track,
    next.catch(() => undefined),
  );
  return next;
}

export class NoiseProcessorSession {
  #operation: Promise<void> = Promise.resolve();
  #generation = 0;
  #attachment: { track: ProcessorTrack; processor: LiveKitNoiseProcessor } | undefined;
  #processors = new WeakMap<ProcessorTrack, LiveKitNoiseProcessor>();

  constructor(
    private readonly createProcessor = () => createLiveKitNoiseProcessor('enhanced'),
    private readonly supported = supportsEnhancedNoiseSuppression,
  ) {}

  update(
    track: ProcessorTrack | undefined,
    mode: NoiseSuppressionMode,
    report: (state: NoiseSuppressionRuntimeState) => void = () => undefined,
  ): Promise<void> {
    const generation = ++this.#generation;
    const current = () => generation === this.#generation;
    const apply = async () => {
      if (!current()) return;
      const supported = mode !== 'enhanced' || this.supported();
      const wantsProcessor = !!track && mode === 'enhanced' && supported;
      if (this.#attachment && (this.#attachment.track !== track || !wantsProcessor)) {
        await this.#detach();
      }
      if (!current()) return;
      if (!wantsProcessor || !track) {
        report({
          effectiveMode: mode === 'enhanced' ? 'browser' : mode,
          error: supported ? null : UNAVAILABLE,
        });
        return;
      }

      let processor = this.#processors.get(track);
      if (!processor) {
        processor = this.createProcessor();
        this.#processors.set(track, processor);
      }
      const ownedProcessor = processor;
      await withTrack(track, async () => {
        if (!current()) return;
        // Publication wrappers and ordinary mute events must not reset RNNoise.
        if (
          track.getProcessor() !== ownedProcessor ||
          ownedProcessor.processedTrack?.readyState !== 'live'
        ) {
          this.#attachment = { track, processor: ownedProcessor };
          await track.setProcessor(ownedProcessor);
        }
      });
      if (current()) report({ effectiveMode: 'enhanced', error: null });
    };

    const next = this.#operation.then(apply).catch(async () => {
      try {
        await this.#detach();
      } finally {
        if (current()) report({ effectiveMode: mode === 'off' ? 'off' : 'browser', error: FAILED });
      }
    });
    // A cleanup failure must not poison subsequent updates or leak a rejection.
    this.#operation = next.catch(() => undefined);
    return this.#operation;
  }

  async #detach() {
    const attachment = this.#attachment;
    this.#attachment = undefined;
    if (!attachment) return;
    const { track, processor } = attachment;
    await withTrack(track, async () => {
      try {
        if (track.getProcessor() === processor) await track.stopProcessor();
      } finally {
        // init may fail before LiveKit records the processor; unpublish may remove it.
        await processor.destroy();
      }
    });
  }
}
