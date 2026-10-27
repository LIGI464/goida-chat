// Browser-only stress check, loaded by lifecycle-check.mjs, never by the application.
import { LocalAudioTrack, Track } from 'livekit-client';
import { NoiseProcessorSession } from './noiseProcessorSession';
import { createLiveKitNoiseProcessor, EnhancedNoiseProcessor } from './noiseProcessors';

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export async function runLifecycleChecks() {
  const contexts = new Set<AudioContext>();
  const worklets = new Set<AudioWorkletNode>();
  const tracks = new Set<MediaStreamTrack>();
  const failures: string[] = [];
  let contextCount = 0;
  let workletCount = 0;
  let moduleCount = 0;
  let peakWorklets = 0;
  let peakTracks = 0;
  const NativeContext = window.AudioContext;
  const NativeWorklet = window.AudioWorkletNode;
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const liveTracks = () => [...tracks].filter((track) => track.readyState === 'live').length;
  function remember(stream: MediaStream) {
    stream.getTracks().forEach((track) => tracks.add(track));
    peakTracks = Math.max(peakTracks, liveTracks());
    return stream;
  }
  window.AudioContext = class extends NativeContext {
    constructor(options?: AudioContextOptions) {
      super(options);
      contexts.add(this);
      contextCount++;
      const addModule = this.audioWorklet.addModule.bind(this.audioWorklet);
      this.audioWorklet.addModule = (...args) => {
        moduleCount++;
        return addModule(...args);
      };
    }
    createMediaStreamDestination() {
      const destination = super.createMediaStreamDestination();
      remember(destination.stream);
      return destination;
    }
  };
  window.AudioWorkletNode = class extends NativeWorklet {
    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
      super(context, name, options);
      workletCount++;
      worklets.add(this);
      peakWorklets = Math.max(peakWorklets, worklets.size);
      this.addEventListener('processorerror', () => failures.push('AudioWorklet processorerror'));
      const close = this.port.close.bind(this.port);
      this.port.close = () => {
        worklets.delete(this);
        close();
      };
    }
  };
  navigator.mediaDevices.getUserMedia = async (options) => remember(await capture(options));

  // Silence detection is an unrelated SDK diagnostic that allocates its own context.
  // Exclude it so counters measure the requested processor lifecycle alone.
  class TestAudioTrack extends LocalAudioTrack {
    async checkForSilence() {
      return false;
    }
  }
  async function microphone(context: AudioContext) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const input = stream.getAudioTracks()[0]!;
    const track = new TestAudioTrack(input, undefined, false, context);
    track.source = Track.Source.Microphone;
    track.stopOnMute = true;
    return track;
  }

  try {
    const context = new AudioContext({ sampleRate: 48_000 });
    await context.resume();
    let track = await microphone(context);
    const session = new NoiseProcessorSession();
    let state = '';
    const report = (next: { effectiveMode: string }) => {
      state = next.effectiveMode;
    };
    await session.update(track, 'enhanced', report);
    check(state === 'enhanced', 'Initial attachment failed');
    const firstOutput = track.getProcessor()?.processedTrack;
    check(
      firstOutput && firstOutput !== track.mediaStream?.getAudioTracks()[0],
      'No processed output',
    );

    for (let cycle = 0; cycle < 100; cycle++) {
      const processor = track.getProcessor();
      const output = processor?.processedTrack;
      const nodesBefore = workletCount;
      await track.mute();
      await track.unmute();
      // restartTrack exercises the SDK path which omits audioContext in restart options.
      await track.restartTrack({ deviceId: 'default' });
      await session.update(track, 'enhanced', report);
      check(
        track.getProcessor() === processor,
        'Processor identity changed on mute/device restart',
      );
      check(processor?.processedTrack === output, 'Output identity changed on device restart');
      check(workletCount === nodesBefore, 'Device restart allocated a worklet');

      await Promise.all([track.restartTrack(), session.update(track, 'browser', report)]);
      check(worklets.size === 0, 'Mode change leaked a worklet');
      check(track.mediaStreamTrack.readyState === 'live', 'Detach stopped the microphone');
      await session.update(track, 'enhanced', report);
      check(track.getProcessor() === processor, 'Mode change replaced the processor object');
      await Promise.all([
        session.update(undefined, 'off'),
        session.update(track, 'off', report),
        session.update(track, 'enhanced', report),
      ]);
      check(state === 'enhanced' && worklets.size === 1, 'Latest mode did not win');

      // Republish to a different LocalAudioTrack, then simulate delayed cleanup of the old one.
      const oldTrack = track;
      const oldProcessor = oldTrack.getProcessor();
      track = await microphone(context);
      await session.update(track, 'enhanced', report);
      await oldProcessor?.destroy();
      oldTrack.stop();
      check(
        track.getProcessor()?.processedTrack?.readyState === 'live',
        'Old track cleanup damaged new output',
      );
      check(worklets.size === 1, 'Republish leaked a worklet');
    }
    check(contextCount === 1 && moduleCount === 1, 'Session allocated extra contexts/modules');
    await session.update(undefined, 'off');
    track.stop();
    check(worklets.size === 0 && liveTracks() === 0, 'Session cleanup leaked resources');
    check(context.state !== 'closed', 'Processor closed the LiveKit context');
    await context.close();

    // 100 enter/leave cycles, including overlapping bridge cleanup and fresh attachment.
    for (let cycle = 0; cycle < 100; cycle++) {
      const sessionContext = new AudioContext({ sampleRate: 48_000 });
      const localTrack = await microphone(sessionContext);
      const oldSession = new NoiseProcessorSession();
      const newSession = new NoiseProcessorSession();
      await oldSession.update(localTrack, 'enhanced');
      await Promise.all([
        newSession.update(localTrack, 'enhanced'),
        oldSession.update(undefined, 'off'),
      ]);
      check(
        localTrack.getProcessor()?.processedTrack?.readyState === 'live',
        'Remount lost its output',
      );
      await newSession.update(undefined, 'off');
      localTrack.stop();
      check(liveTracks() === 0 && worklets.size === 0, 'Leave leaked resources');
      await sessionContext.close();
    }

    // Cancel an in-flight worklet load, then prove a later init can recover.
    const delayedContext = new AudioContext({ sampleRate: 48_000 });
    const input = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0]!;
    const originalLoad = delayedContext.audioWorklet.addModule.bind(delayedContext.audioWorklet);
    let release!: () => void;
    let started!: () => void;
    const loading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    delayedContext.audioWorklet.addModule = async (...args) => {
      started();
      await gate;
      return originalLoad(...args);
    };
    const processor = createLiveKitNoiseProcessor('enhanced');
    const initializing = processor.init({
      kind: Track.Kind.Audio,
      track: input,
      audioContext: delayedContext,
    });
    const cancelled = initializing.then(
      () => false,
      () => true,
    );
    await loading;
    const destroying = processor.destroy();
    release();
    await destroying;
    check(await cancelled, 'Cancelled initialization succeeded');
    check(
      worklets.size === 0 && !processor.processedTrack,
      'Cancelled initialization leaked output',
    );
    await processor.init({ kind: Track.Kind.Audio, track: input, audioContext: delayedContext });
    await processor.destroy();
    check(input.readyState === 'live', 'Cleanup stopped borrowed input');

    // Throw after allocating the destination and worklet: all partial resources must go.
    const createSource = delayedContext.createMediaStreamSource.bind(delayedContext);
    delayedContext.createMediaStreamSource = (stream) => {
      const source = createSource(stream);
      source.connect = () => {
        throw new Error('Injected graph connection failure');
      };
      return source;
    };
    const failedGraph = await processor
      .init({ kind: Track.Kind.Audio, track: input, audioContext: delayedContext })
      .then(
        () => false,
        () => true,
      );
    check(
      failedGraph && worklets.size === 0 && liveTracks() === 1,
      'Partial graph creation leaked resources',
    );
    delayedContext.createMediaStreamSource = createSource;
    await processor.init({ kind: Track.Kind.Audio, track: input, audioContext: delayedContext });
    await processor.destroy();
    input.stop();
    await delayedContext.close();

    const unsupportedContext = new AudioContext({ sampleRate: 44_100 });
    const unsupportedInput = (
      await navigator.mediaDevices.getUserMedia({ audio: true })
    ).getAudioTracks()[0]!;
    const rejected = await new EnhancedNoiseProcessor()
      .createProcessedTrack(unsupportedInput, unsupportedContext)
      .then(
        () => false,
        () => true,
      );
    check(rejected, 'Unsupported sample rate must fail without creating a new context');
    unsupportedInput.stop();
    await unsupportedContext.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    check(failures.length === 0, failures.join(', '));
    check(liveTracks() === 0 && worklets.size === 0, 'Final resource leak');
    return {
      cycles: {
        muteUnmute: 100,
        deviceChanges: 100,
        modeChanges: 100,
        republish: 100,
        enterLeave: 100,
      },
      contextsCreatedByFixtures: contextCount,
      contextsCreatedByProcessor: contextCount - 103,
      contextsStillOpen: [...contexts].filter((item) => item.state !== 'closed').length,
      workletsCreated: workletCount,
      workletsStillOwned: worklets.size,
      peakWorklets,
      tracksCreated: tracks.size,
      liveTracks: liveTracks(),
      peakTracks,
      moduleCount,
    };
  } finally {
    tracks.forEach((track) => track.stop());
    await Promise.all(
      [...contexts]
        .filter((context) => context.state !== 'closed')
        .map((context) => context.close()),
    );
    window.AudioContext = NativeContext;
    window.AudioWorkletNode = NativeWorklet;
    navigator.mediaDevices.getUserMedia = capture;
  }
}
