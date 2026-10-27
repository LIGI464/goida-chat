# Noise processor lifecycle verification

Run from the repository root with Node 22+ and Chrome or Edge installed:

```sh
node apps/web/src/features/voice/audio/lifecycle-check.mjs
npm run lint
npm run typecheck -w @goida-chat/web
npm run build -w @goida-chat/web
```

Set `CHROME_PATH` if the browser is not in a standard Windows installation directory.
The runner starts a localhost Vite server and an isolated headless browser with a
synthetic microphone. It uses the installed LiveKit SDK and the real RNNoise WASM
and AudioWorklet. The check files are not imported into the application bundle.

The check runs 100 cycles each of mute/unmute (including microphone reacquisition),
device restart, mode changes, replacement of the published local track, and voice
bridge enter/leave. It checks stable processor/output identity across restart,
latest-request ordering, overlapping old/new session cleanup, cancellation during
worklet loading, partial graph construction failure, recovery, borrowed input
ownership, and rejection of a 44.1 kHz context without allocating another context.

Verified on 2026-10-27 with LiveKit 2.19.2 and RNNoise wrapper 0.3.5:

| Resource | Created | Remaining after cleanup | Peak simultaneously owned/live |
| --- | ---: | ---: | ---: |
| AudioContext created by the processor | 0 | 0 | 0 |
| AudioContext supplied by the test fixture | 103 | 0 | 1 |
| AudioWorkletNode | 404 | 0 | 1 |
| MediaStreamTrack (input and output) | 907 | 0 | 3 |

The normal session loads the worklet module once across all 100 cycles. Across
all contexts there are 102 module registrations; the rejected 44.1 kHz context
does not register it. Worklet ownership is counted until its port is closed;
this is not a browser heap or WASM-memory measurement. Input/output tracks are
counted through capture and destination creation, then checked for `readyState`.
The unrelated LiveKit silence diagnostic is disabled in the fixture because it
allocates its own diagnostic contexts. No production code is changed for this.

All three repository checks pass. Build retains the existing large-chunk warning.
This verifies local SDK/processor lifecycle with synthetic capture; it does not
claim a networked LiveKit room test, physical device switching, or acoustic quality
validation. The existing audio level meter is outside this change's scope.
