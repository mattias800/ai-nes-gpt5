# Browser Harness Performance and Audio Stability Plan

This document captures findings and an implementation plan to address slow performance and choppy audio in the web browser harness of ai-nes-gpt5.

## Findings

- Architecture (current)
  - Audio
    - AudioWorklet + SharedArrayBuffer (SAB) ring buffer is present.
      - Reader (worklet): `src/host/browser/worklets/nes-audio-processor.ts` — pulls from SAB; increments `Underruns` and updates `LastOccupancy`.
      - Writer (worker): `src/host/browser/workers/nesCore.worker.ts` — generates audio and writes into SAB.
      - SAB ring: `src/host/browser/audio/shared-ring-buffer.ts` — Atomics-based.
    - Dev server sets COOP/COEP; preview does not (potential release issue for SAB).
  - Video
    - Main thread uses Canvas 2D per-frame colorization: `main.ts` `drawIndices()` creates a new ImageData, loops over 61,440 pixels (`256x240`) to map idx→RGB, then `putImageData`.
    - Worker sends frames at ~60 Hz via `setInterval`.
  - Scheduling
    - Audio pump in worker is driven by `setInterval(pumpAudio, 1)`.
    - Video send is driven by `setInterval(1000/60)`.
    - No vsync (`requestAnimationFrame`), no adaptive frame limiter.

- Likely root causes
  - Per-pump allocations: worker allocates a new `Float32Array` per audio pump, causing GC stalls and jitter.
  - Timer-based scheduling: `setInterval` is jittery and competes with main-thread work. Audio should be paced by audio clock (ring occupancy). Video should present on vsync.
  - Heavy CPU conversion each frame (Canvas 2D + new ImageData + full per-pixel loop), not synced to vsync.
  - Release/preview SAB headers missing: `vite preview` lacks COOP/COEP; SAB is unavailable there.

## Goals
- Timing
  - Use audio clock to pace the emulator: maintain SAB occupancy near a target with adaptive pumping. Keep a small audio quantum and avoid overruns.
  - Present video on vsync with `requestAnimationFrame`. Keep an adaptive frame limiter by coalescing frames (always draw the latest, drop stale).
- Audio latency
  - Prefer a shared ring buffer with small chunks (e.g., 128–1024 frames) without requiring users to tune buffers. Keep an internal target (e.g., 4096 frames) and adapt.

## Implementation Plan

1) Telemetry (observability)
- Worker (`src/host/browser/workers/nesCore.worker.ts`)
  - Measure audio pump duration (ms), frames produced per pump, ring occupancy min/avg/max.
  - Post telemetry to main once per second (`type: 'worker-stats'`).
- Worklet (`src/host/browser/worklets/nes-audio-processor.ts`)
  - Count underruns and track SAB occupancy (min/avg/max) using Atomics.
  - Post to main via `port` periodically (`type: 'worklet-stats'`).
- Main overlay (`src/host/browser/main.ts`)
  - Enable via `?stats=1`.
  - Show: underruns, SAB occupancy (min/avg/max), pump ms avg/95p, frames/pump avg, video fps, frames dropped, draw ms (EMA).

2) Remove per-pump allocations
- Preallocate a `Float32Array` scratch buffer of `maxChunkFrames * channels` in the worker after `init`.
- Reuse it via `subarray(0, frames * channels)` in each pump.
- Optional stage 2: zero-copy generation directly into SAB via claim/commit API (future).

3) Adaptive audio pacing
- Maintain a `targetFillFrames` (e.g., 4096) with low/high watermarks.
- If below low watermark, schedule immediate micro backfill (`setTimeout(0)`) in addition to the 1ms pump cadence.

4) Vsync video presenter and coalescing
- In main, store only the latest frame from the worker and render on `requestAnimationFrame`.
- Use a fast path to convert indices→RGBA by precomputing a `Uint32Array` palette and writing to a reused `ImageData`’s `Uint32Array` view, then `putImageData` once.
- Track fps, frames dropped, and draw ms EMA.
- Optional future: WebGL2 presenter behind `?gpu=webgl`.

5) SAB availability and preview headers
- `main.ts`: if `!crossOriginIsolated`, show a friendly message and abort (SAB unavailable without COOP/COEP).
- `vite.config.ts`: add `preview.headers` mirroring `server.headers` for COOP/COEP/CORP.
- Document production headers for SAB.

## Acceptance Criteria
- Audio underruns remain 0 after warmup for ≥ 5 minutes.
- SAB occupancy stays near target (e.g., within ±25% once warmed up).
- Video smooth at ~60 fps; frames dropped low under normal load. Under stress, audio stable and video drops smoothly.
- No periodic GC spikes aligned with audio pump after removing per-pump allocations.

## Files To Change
- `src/host/browser/workers/nesCore.worker.ts` — telemetry, preallocation, adaptive pacing.
- `src/host/browser/worklets/nes-audio-processor.ts` — underrun/occupancy telemetry.
- `src/host/browser/main.ts` — stats overlay (`?stats=1`), `requestAnimationFrame` presenter, worker/worklet stats wiring, SAB availability check.
- `vite.config.ts` — add preview headers.

## Notes
- Keep arrow functions, strict types, and avoid `any` as per project rules.
- Keep allocations out of audio/render critical paths.
- Audio remains the source of truth; video does not throttle audio.

