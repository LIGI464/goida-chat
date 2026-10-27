# Noise suppression comparison lab

Open `/audio/noise-lab` after signing in. The route loads the lab lazily. It does not import production voice lifecycle helpers, join a LiveKit room, write voice preferences, or select a new default.

## Modes

| Mode              | DSP nodes | Browser NS | Browser AGC | AEC | Identical file replay |
| ----------------- | --------- | ---------- | ----------- | --- | --------------------- |
| Raw               | 0         | off        | off         | off | yes                   |
| Browser NS        | 0         | on         | off         | off | capture only          |
| Browser AGC       | 0         | off        | on          | off | capture only          |
| Browser AEC       | 0         | off        | off         | on  | capture only          |
| RNNoise           | 1         | off        | off         | off | yes                   |
| RNNoise + AEC     | 1         | off        | off         | on  | capture only          |
| Speex             | 1         | off        | off         | off | yes                   |
| Experimental gate | 1         | off        | off         | off | yes                   |

RNNoise and Speex use the existing `@sapphi-red/web-noise-suppressor` package. Gate settings are open −35 dB, close −40 dB, hold 150 ms. No mode stacks two denoisers. For custom DSP, AEC is an explicit separate capture experiment, never browser NS or AGC. Voice isolation is requested off where supported. The actual track settings must confirm NS/AGC/AEC; unsupported or mismatched constraints fail visibly. This does not control DSP in microphone firmware or the OS.

GTCRN is intentionally absent. It needs a separate spike covering model provenance, worklet/worker adapter, frame/sample-rate conversion, scheduling, disposal, browser support and measured quality/latency/CPU before entering this registry.

## Repeatable quality comparison

1. Prepare 1–20 second recordings of speech only, keyboard only, fan only, music only, and speech mixed with each noise. Use the same speaker, device, level and distance. Include a clean speech reference for listening. Keep gain fixed; do not normalize individual outputs.
2. Upload files under the matching category (up to 8 files, 20 MB each), or record an 8-second raw reference in the lab. Decoding resamples to 48 kHz and downmixes channels by averaging. All file-capable modes receive the same decoded mono samples. Original file SHA-256 and category are exported.
3. Run all modes. Browser capture modes are explicitly skipped for files: Web Audio streams cannot apply microphone NS/AGC/AEC. There is no passthrough disguised as browser processing.
4. To compare browser processing, feed the same WAV through a virtual input (or Chromium file-backed fake capture for automation), restart playback identically for each separately selected mode, and document alignment/device configuration. Live input is labelled as a separate capture and has no identical-file hash. AEC effectiveness additionally needs a controlled speaker/echo reference, so a virtual mic alone does not validate echo cancellation.
5. Listen to input/output WAVs, score speech preservation (100 best) and residual keyboard/fan/music (0 best). Mixed-signal energy cannot identify which source survived; the application does not fabricate these scores. Separate noise-only files allow RMS energy reduction to be interpreted for that noise. No perceptual speech-quality model is claimed.
6. Export JSON plus WAVs before clearing the set. The report includes source hash, category, browser, hardware concurrency, settings, timestamps, sample rate, numeric metrics, manual scores, CPU notes and stability results. Live comparisons append so earlier modes remain available.

## Metrics and limits

- Input and output are recorded in a single two-input AudioWorklet, on one context clock. The recorder outputs silence to avoid microphone feedback. There is one recorder in addition to zero or one denoiser.
- Delay is a normalized waveform cross-correlation estimate over 0–200 ms after excluding the first 0.5 seconds. Correlation below 0.5, silence or a boundary maximum yields no estimate. Periodic signals can produce ambiguous peaks. This is incremental DSP delay, **not** capture, network, hardware or end-to-end latency. `baseLatency` and setup time are exported separately.
- RMS levels are dBFS; energy reduction is input dBFS minus output dBFS **inside the Web Audio DSP graph**. For live capture the reference is already after browser NS/AGC/AEC, so a browser-only mode correctly has a zero graph delta; compare its output level/WAV with a separately captured raw baseline on the identical virtual-input fixture. Exact silence has a separate flag and a null logarithmic level. A silent result is not automatically a successful denoiser. Clipped output samples are counted. Live capture is explicitly downmixed to mono even if the device ignores `channelCount: 1`.
- CPU is entered from an external profiler with the machine, profiler, sampling interval and baseline in notes. Browsers do not expose portable AudioWorklet CPU utilization. The browser smoke test also samples Chrome process CPU via CDP: total CPU seconds for surviving isolated-browser processes divided by wall time, as % of one core. That includes setup, capture and analysis and is **not** DSP-only CPU; it can exceed 100%. Use repeated longer recordings and idle-baseline subtraction for a production decision.
- 50/100 cycles fully initialize, process the first file, destroy nodes, stop tracks and await context closure. Live cycles capture 1 second each. Counts are application-owned resource accounting, not proof against internal browser/WASM leaks. Inspect browser process memory/CPU over a longer run before selecting a default.
- Cancellation, errors and unmount close sessions; a late microphone grant is immediately stopped. WASM fetches have a 15-second timeout. The package offers no WASM-ready event, so each run has 400 ms warm-up; processor errors, silence and recording timeouts remain visible.

## Reproduce validation

```sh
npm ci --ignore-scripts
npm run db:generate
npm run test:noise-lab
npm run test:noise-lab:serve
# In a second terminal; uses isolated headless Chrome and artificial audio only:
npm run test:noise-lab:browser
npm run lint
npm run typecheck
npm run build
```

The browser runner defaults to the installed Windows Chrome path. `LAB_CHROME`, `LAB_ORIGIN`, `LAB_CYCLES` and comma-separated `LAB_STRESS_MODES` override it. It uses a temporary browser profile, writes screenshots/report there, and closes only its own browser. It does not use the user's browser session or physical microphone. The test page under `apps/web/tests` is a development harness, not a production bundle entry.

The synthetic harmonic fixture verifies the audio pipeline and lifecycle. It cannot establish speech preservation or real-world keyboard/fan/music suppression, and it is not evidence for changing the default.
