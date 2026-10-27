import {
  NoiseGateWorkletNode,
  RnnoiseWorkletNode,
  SpeexWorkletNode,
} from '@sapphi-red/web-noise-suppressor';
import rnWorklet from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnWasm from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import speexWorklet from '@sapphi-red/web-noise-suppressor/speexWorklet.js?url';
import speexWasm from '@sapphi-red/web-noise-suppressor/speex.wasm?url';
import gateWorklet from '@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url';

export const MODES = [
  { id: 'raw', label: 'Raw microphone', dsp: null, ns: false, agc: false, aec: false },
  { id: 'browser-ns', label: 'Browser · NS only', dsp: null, ns: true, agc: false, aec: false },
  { id: 'browser-agc', label: 'Browser · AGC only', dsp: null, ns: false, agc: true, aec: false },
  { id: 'browser-aec', label: 'Browser · AEC only', dsp: null, ns: false, agc: false, aec: true },
  { id: 'rnnoise', label: 'RNNoise', dsp: 'rnnoise', ns: false, agc: false, aec: false },
  { id: 'rnnoise-aec', label: 'RNNoise + AEC', dsp: 'rnnoise', ns: false, agc: false, aec: true },
  { id: 'speex', label: 'Speex', dsp: 'speex', ns: false, agc: false, aec: false },
  {
    id: 'experimental',
    label: 'Experimental · noise gate',
    dsp: 'gate',
    ns: false,
    agc: false,
    aec: false,
  },
] as const;
export type LabMode = (typeof MODES)[number];
export type ModeId = LabMode['id'];
export const resources = { contexts: 0, denoisers: 0, recorders: 0, tracks: 0 };
export const fileCapable = (mode: LabMode) => !mode.ns && !mode.agc && !mode.aec;

export function captureConstraints(mode: LabMode, deviceId: string): MediaTrackConstraints {
  const constraints: MediaTrackConstraints & { voiceIsolation?: ConstrainBoolean } = {
    channelCount: 1,
    noiseSuppression: { exact: mode.ns },
    autoGainControl: { exact: mode.agc },
    echoCancellation: { exact: mode.aec },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
  const supported =
    navigator.mediaDevices.getSupportedConstraints() as MediaTrackSupportedConstraints & {
      voiceIsolation?: boolean;
    };
  if (supported.voiceIsolation) constraints.voiceIsolation = { exact: false };
  return constraints;
}

export function verifyCapture(mode: LabMode, settings: MediaTrackSettings) {
  for (const [key, wanted] of [
    ['noiseSuppression', mode.ns],
    ['autoGainControl', mode.agc],
    ['echoCancellation', mode.aec],
  ] as const) {
    if (settings[key] !== wanted)
      throw new Error(`Браузер не подтвердил ${key}=${wanted}; измерение отклонено.`);
  }
  if ((settings as MediaTrackSettings & { voiceIsolation?: boolean }).voiceIsolation === true) {
    throw new Error('Voice isolation остался включён. Изолированный тест невозможен.');
  }
}

const binaries = new Map<string, Promise<ArrayBuffer>>();
async function binary(url: string) {
  let pending = binaries.get(url);
  if (!pending) {
    pending = fetch(url, { signal: AbortSignal.timeout(15000) })
      .then(async (response) => {
        if (!response.ok) throw new Error(`WASM: HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .catch((error: unknown) => {
        binaries.delete(url);
        throw error;
      });
    binaries.set(url, pending);
  }
  return pending;
}

export type Adapter = { output: AudioNode; node: AudioWorkletNode | null; dispose: () => void };
// Context closure is awaited by the runner, including failed WASM initialization.
export async function createAdapter(
  context: AudioContext,
  input: AudioNode,
  mode: LabMode,
): Promise<Adapter> {
  if (!mode.dsp) return { output: input, node: null, dispose: () => undefined };
  if (context.sampleRate !== 48000) throw new Error('Лаборатория требует 48 kHz.');
  let node: AudioWorkletNode & { destroy?: () => void };
  if (mode.dsp === 'rnnoise') {
    const wasmBinary = await binary(rnWasm);
    await context.audioWorklet.addModule(rnWorklet);
    node = new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary });
  } else if (mode.dsp === 'speex') {
    const wasmBinary = await binary(speexWasm);
    await context.audioWorklet.addModule(speexWorklet);
    node = new SpeexWorkletNode(context, { maxChannels: 1, wasmBinary });
  } else {
    await context.audioWorklet.addModule(gateWorklet);
    node = new NoiseGateWorkletNode(context, {
      maxChannels: 1,
      openThreshold: -35,
      closeThreshold: -40,
      holdMs: 150,
    });
  }
  resources.denoisers++;
  input.connect(node);
  let disposed = false;
  return {
    output: node,
    node,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      node.destroy?.();
      node.disconnect();
      node.port.close();
      resources.denoisers--;
    },
  };
}
