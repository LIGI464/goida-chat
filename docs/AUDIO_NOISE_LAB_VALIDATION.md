# Validation — 2026-10-27

Branch: `feat/audio-noise-lab`, based on `origin/feat/invite-links` (`bc344ae`). No default selection was made.

## Executed checks

- Full repository lint, typecheck and production build.
- Four signal tests: known 137-sample delay and 6.02 dB attenuation, silence, raw identity, PCM WAV encoding.
- Headless Windows Chrome with its own temporary profile and an artificial audio device. No physical microphone or user browser profile was accessed.
- Raw, RNNoise, Speex and experimental gate each completed 100 full initialize/process/dispose cycles on the deterministic harmonic/noise fixture. After each successful cycle: 0 contexts, 0 denoisers, 0 recorders, 0 tracks. DSP peak: 0 for raw, 1 for custom modes; recorder/context peak: 1 each.
- Experimental was rerun on a test server without HMR after development-server reloads interrupted earlier attempts at 30 and 70 cycles. Those interrupted attempts were not counted as passes.
- Final smoke repeated all modes using the WAV-encoded fixture, browser NS/AGC/AEC and RNNoise+AEC using the same WAV as Chrome's file-backed microphone, and the final explicit mono capture graph.
- Cancellation during recording, denied microphone permission, injected worklet load failure, and rejection of browser processing on a decoded file all passed with zero remaining registered resources.
- UI upload → compare all → preserve previous results when running another mode passed. All four compatible modes produced input/output WAV controls; browser file modes displayed explicit skips. At a 390×844 viewport, document and lab content widths were both 390 pixels and the page scrolled vertically.

## Diagnostic measurements from the final smoke

These use a one-second synthetic harmonic signal with seeded noise, not speech or recordings of a keyboard, fan or music. Delay is graph waveform correlation; it is not device/end-to-end latency. CPU is the sum of CPU time in surviving processes of the isolated Chrome instance divided by wall time (% of one core), including cold setup, WASM compilation and analysis, without an idle baseline. It is deliberately **not** labelled as processor-only utilization or a quality ranking.

| File mode         | Estimated DSP delay, ms | Correlation | Output, dBFS | DSP energy reduction, dB | Browser CPU, % of one core |
| ----------------- | ----------------------: | ----------: | -----------: | -----------------------: | -------------------------: |
| Raw               |                    0.00 |       1.000 |      -22.681 |                    0.000 |                      15.57 |
| RNNoise           |                   14.77 |       0.984 |      -22.889 |                    0.208 |                     123.03 |
| Speex             |                    2.67 |       0.981 |      -23.649 |                    0.968 |                       6.67 |
| Experimental gate |                    0.00 |       1.000 |      -22.681 |                    0.000 |                       4.05 |

Capture settings confirmed independently: NS only `(true,false,false)`, AGC only `(false,true,false)`, AEC only `(false,false,true)` for `(noiseSuppression,autoGainControl,echoCancellation)`. RNNoise+AEC confirmed `(false,false,true)` with one custom denoiser. Voice isolation was false throughout. Chrome returned two channels at 44.1 kHz for raw despite the ideal mono request; the lab now explicitly downmixes and the AudioContext resamples to 48 kHz.

## Still requires acoustic evaluation

Speech preservation, residual real keyboard/fan/music, AEC effectiveness, calibrated end-to-end latency, sustained CPU after warm-up, OS/device DSP effects and internal process memory trends have not been established by this synthetic test. The lab provides separate fixtures, WAV listening, external-profiler fields, notes and JSON export for that evaluation. Unmeasured values remain null. None of these diagnostic numbers justify changing the production default.
