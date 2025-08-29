# Agent Notes for ai-nes-gpt5

- Browser host currently feeds audio to an AudioWorklet via main-thread `setInterval` (src/host/browser/main.ts) and the worklet pulls from a message-queue (src/host/browser/nes-worklet.js). This is vulnerable to jitter/GC and causes buffer underruns (audible stutter).
- Goal: Switch to AudioWorklet + SharedArrayBuffer (SAB) ring buffer (consumer) and move emulator core to a Dedicated Worker (producer). Enable COOP/COEP headers in dev and prod for SAB.
- Prefer TypeScript with strict types; avoid `any`. Arrow functions only. Keep allocations out of the audio render path.
- Add diagnostics and drift control to keep the ring buffer near a target fill, minimizing glitches.
- Keep video rendering on the main thread, receiving frames from the worker.
