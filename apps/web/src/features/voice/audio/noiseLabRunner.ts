import captureUrl from './labCapture.worklet.js?url';
import {
  captureConstraints,
  createAdapter,
  fileCapable,
  resources,
  verifyCapture,
  type Adapter,
  type LabMode,
} from './noiseLabAdapters';
import { measureSignal, wav } from './noiseLabMetrics';

export type FixtureKind = 'speech' | 'keyboard' | 'fan' | 'music' | 'mixed' | 'synthetic';
export type Fixture = { name: string; hash: string; kind: FixtureKind; pcm: Float32Array };
export type LabSource =
  | { type: 'file'; fixture: Fixture }
  | { type: 'microphone'; deviceId: string; seconds: number };
export type RunResult = {
  mode: string;
  source: string;
  fixtureHash: string | null;
  kind: FixtureKind;
  settings: MediaTrackSettings | null;
  sampleRate: number;
  seconds: number;
  metrics: ReturnType<typeof measureSignal>;
  setupMs: number;
  baseLatencyMs: number;
  peakResources: typeof resources;
  afterResources: typeof resources;
  inputWav: Blob;
  outputWav: Blob;
  capturedAt: string;
};

export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function microphone(mode: LabMode, deviceId: string, signal: AbortSignal) {
  // Permission prompts can remain pending after navigation. Stop a late grant.
  return new Promise<MediaStream>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    navigator.mediaDevices.getUserMedia({ audio: captureConstraints(mode, deviceId) }).then(
      (stream) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        resolve(stream);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export async function decodeFixture(file: File, kind: FixtureKind): Promise<Fixture> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Максимальный размер файла — 20 MB.');
  const bytes = await file.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const decoder = new OfflineAudioContext(1, 1, 48000);
  const decoded = await decoder.decodeAudioData(bytes);
  if (decoded.duration < 1 || decoded.duration > 20)
    throw new Error('Нужна запись длительностью от 1 до 20 секунд.');
  // Explicitly downmix stereo; every adapter receives these exact samples.
  const pcm = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i]! + data[i]! / decoded.numberOfChannels;
  }
  return { name: file.name, hash, kind, pcm };
}

export async function runLab(
  mode: LabMode,
  source: LabSource,
  signal: AbortSignal,
): Promise<RunResult> {
  if (source.type === 'file' && !fileCapable(mode))
    throw new Error(
      'Browser NS/AGC/AEC работают только на захвате. Выберите микрофон или виртуальный вход.',
    );
  if (Object.values(resources).some(Boolean))
    throw new Error('Предыдущая сессия ещё не освобождена.');
  signal.throwIfAborted();
  const started = performance.now();
  const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  resources.contexts++;
  let stream: MediaStream | null = null;
  let adapter: Adapter | null = null;
  let recorder: AudioWorkletNode | null = null;
  let input: AudioNode | null = null;
  let microphoneSource: MediaStreamAudioSourceNode | null = null;
  let player: AudioBufferSourceNode | null = null;
  let settings: MediaTrackSettings | null = null;
  try {
    await context.resume();
    signal.throwIfAborted();
    if (source.type === 'file') {
      player = context.createBufferSource();
      const buffer = context.createBuffer(1, source.fixture.pcm.length, 48000);
      buffer.getChannelData(0).set(source.fixture.pcm);
      player.buffer = buffer;
      input = player;
    } else {
      stream = await microphone(mode, source.deviceId, signal);
      resources.tracks += stream.getTracks().length;
      settings = stream.getAudioTracks()[0]!.getSettings();
      verifyCapture(mode, settings);
      microphoneSource = context.createMediaStreamSource(stream);
      const mono = context.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = 'explicit';
      mono.channelInterpretation = 'speakers';
      microphoneSource.connect(mono);
      input = mono;
    }
    adapter = await createAdapter(context, input, mode);
    signal.throwIfAborted();
    await context.audioWorklet.addModule(captureUrl);
    recorder = new AudioWorkletNode(context, 'goida-noise-lab-capture', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    resources.recorders++;
    input.connect(recorder, 0, 0);
    adapter.output.connect(recorder, 0, 1);
    recorder.connect(context.destination);
    // The package initializes WASM asynchronously without a ready event. Warm-up
    // is deliberately outside the captured fixture. Silence/errors remain visible.
    await delay(400, signal);
    const seconds =
      source.type === 'file' ? source.fixture.pcm.length / 48000 + 0.25 : source.seconds;
    const setupMs = performance.now() - started;
    const peakResources = { ...resources };
    const start = Math.ceil(((context.currentTime + 0.1) * 48000) / 128) * 128;
    const captureNode = recorder;
    const processed = adapter.node;
    const captured = await new Promise<{ input: Float32Array; output: Float32Array }>(
      (resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          processed?.removeEventListener('processorerror', failure);
          captureNode.removeEventListener('processorerror', failure);
          captureNode.port.onmessage = null;
        };
        const abort = () => {
          cleanup();
          reject(signal.reason);
        };
        const failure = () => {
          cleanup();
          reject(new Error('AudioWorklet processorerror'));
        };
        const timeout = setTimeout(
          () => {
            cleanup();
            reject(new Error('Истёк срок ожидания аудиоданных. Держите вкладку активной.'));
          },
          (seconds + 5) * 1000,
        );
        signal.addEventListener('abort', abort, { once: true });
        processed?.addEventListener('processorerror', failure, { once: true });
        captureNode.addEventListener('processorerror', failure, { once: true });
        captureNode.port.onmessage = ({ data }) => {
          cleanup();
          resolve(data);
        };
        captureNode.port.postMessage({ type: 'record', start, frames: Math.ceil(seconds * 48000) });
        player?.start(start / 48000);
        if (signal.aborted) abort();
      },
    );
    return {
      mode: mode.id,
      source:
        source.type === 'file' ? source.fixture.name : 'live microphone (not identical replay)',
      fixtureHash: source.type === 'file' ? source.fixture.hash : null,
      kind: source.type === 'file' ? source.fixture.kind : 'mixed',
      settings,
      sampleRate: context.sampleRate,
      seconds,
      metrics: measureSignal(captured.input, captured.output, 48000),
      setupMs,
      baseLatencyMs: context.baseLatency * 1000,
      peakResources,
      afterResources: { ...resources },
      inputWav: wav(captured.input),
      outputWav: wav(captured.output),
      capturedAt: new Date().toISOString(),
    };
  } finally {
    try {
      player?.stop();
    } catch {
      /* BufferSource may not have started. */
    }
    input?.disconnect();
    microphoneSource?.disconnect();
    adapter?.dispose();
    if (recorder) {
      recorder.disconnect();
      recorder.port.close();
      resources.recorders--;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      resources.tracks -= stream.getTracks().length;
    }
    await context.close();
    resources.contexts--;
  }
}

export async function runAndRelease(mode: LabMode, source: LabSource, signal: AbortSignal) {
  const result = await runLab(mode, source, signal);
  result.afterResources = { ...resources };
  if (Object.values(resources).some(Boolean)) throw new Error('После теста остались ресурсы.');
  return result;
}
