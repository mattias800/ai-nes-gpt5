# ai-nes-gpt5 — NES emulator (TypeScript), accuracy-first, fully automated

Authorship & purpose (AI-generated)
- Purpose: this repository exists to test whether AI can autonomously create an accurate NES emulator and surrounding tooling. The goal was not for a human to handcraft an emulator, but to evaluate AI capabilities end‑to‑end.
- Authors: gpt-5 (high reasoning), opus 4, Cursor Auto
- Provenance: no human has written a line of code in this repository; all code, refactors, browser harness work, and test scaffolding were produced by AI tools. Changes land via machine‑generated diffs, and automated tests are the source of truth.

![SMB3 Title Animation](screenshots/smb3_title_30fps_5s_2x.gif)

ai-nes-gpt5 is a headless NES (RP2A03/RP2C02) emulator written in TypeScript with a strict, automated, test-first workflow. Local verification is the source of truth: correctness gates must pass before any manual trial is considered.

Important: This project emphasizes automated verification and determinism. Remote CI has been intentionally removed; all verification is local.

Contents
- Authorship & purpose (AI-generated)
- Overview
- Browser host (Web)
- Design goals
- Quick start
- Local verification and test buckets
- Accuracy and timing (VT mode)
- ROM-driven deterministic baselines (SMB, SMB3)
- Optional screenshots and artifacts
- Instrumentation and diagnostics
- Architecture layout
- Known limitations
- Authorship & provenance
- Development workflow
- Licensing and ROM policy
- Acknowledgements

Overview
- Language/runtime: TypeScript, Node.js, browser-hosted Web platform
- Scope: CPU (6502 without decimal), PPU (RP2C02), APU (frame counter, pulse/triangle/noise/DMC), mappers (NROM, UxROM, CNROM, MMC1, MMC3)
- Headless by design: core is UI-agnostic; tests and harnesses drive video/audio deterministically
- Browser host included: dedicated Worker runs the NES core; AudioWorklet + SharedArrayBuffer ring buffer feeds low-latency audio; main thread renders video to a 2D canvas with palette mapping
- Development modality: AI-driven, automated file edits and scripted verification (local-only); changes land via reproducible diffs and tests.

Design goals
- Correctness over everything (see PLAN.md and PLANS/*)
- Determinism: tests run with fixed timing and inputs to yield stable CRCs or PASS flags
- Complete automation: tests assert correctness without manual inspection or interactivity
- Local-only verification: no GitHub Actions or other remote CI; reproducible via npm scripts

Quick start
- Node.js 18+ recommended
- Install dependencies: `npm install`
- Dev server (browser host with COOP/COEP headers for SAB): `npm run dev` then open http://localhost:5173/
- Load your .nes file via the UI and click Start
- Full local verification (fast + slow with VT timing): `npm run verify`
- Run all tests with coverage: `npm test`
- Build TypeScript (for Node-only workflows or distribution): `npm run build`
- Fetch public test ROMs (optional): `npm run fetch:roms` (configure or place files under ./roms)

Local verification and test buckets
- Fast bucket: `npm run test:fast` (CPU/APU/PPU/mappers/unit/system) — quick signal
- Slow bucket: `npm run test:slow` (full-frame, SMB/SMB3 harnesses, long runs)
- Single-file: `vitest run path/to/test.ts`
- Accuracy summary (buckets JSON): `npm run accuracy:report` (prints a JSON summary of pass/fail per bucket)

Accuracy and timing (VT mode)
- Tests default to vertical-timing sampling (PPU_TIMING_DEFAULT=vt) for realistic scroll/copy timing, NMI edge behavior, and odd-frame skip.
- You can override per run: `PPU_TIMING_DEFAULT=legacy npm run test:fast` (not recommended for accuracy).

ROM-driven deterministic baselines
- Super Mario Bros (boot CRC):
  - Place an SMB ROM locally (do not commit). Either drop it in the repo root or set `SMB_ROM=/absolute/path/to/mario.nes`.
  - Record baseline: `npm run baseline:smb` (defaults to 60 frames, VT timing). Add `--frames=120` or `--rom=/path/to/mario.nes` as needed.
  - The test [@smb-baseline] will assert against the recorded CRC when the ROM is present.
- Super Mario Bros. 3 (MMC3) baselines:
  - Place an SMB3 ROM locally. Prefer smb3*.nes or mario3*.nes in the repo root, or set `SMB3_ROM=/absolute/path/to/smb3.nes`.
  - Record title + deep frames: `npm run baseline:smb3` with `--title-frames=120 --deep-frames=600` as desired.
  - Optional input-script baselines:
    - Basic: `npm run baseline:smb3:input -- --script=tests/resources/smb3.input.json --frames=1800 --rom=/path/to/smb3.nes`
    - Extended checkpoints: `npm run baseline:smb3:input:extended -- --script=tests/smb3/input_script_extended.json --rom=/path/to/smb3.nes`
  - Optional state CRC baselines: `npm run baseline:smb3:state -- --frames=60 --rom=/path/to/smb3.nes`

Nestest CPU trace and comparator
- Place nestest.nes and nestest.log under ./roms or set env vars:
  - NESTEST_ROM=/absolute/path/to/nestest.nes
  - NESTEST_LOG=/absolute/path/to/nestest.log
- Generate stdout trace and diff (prefix with NESTEST_MAX to limit):
  - NESTEST_MAX=500 npm run nestest:diff
- Lockstep comparison (halts on first mismatch, prints diagnostics):
  - NESTEST_MAX=2000 npm run nestest:compare
  - npm run nestest:compare (full log)
- Optional instrumentation during trace:
  - NESTEST_TRACE_EXTRA=1 npm run nestest:trace -- --max=200

Optional screenshots and artifacts
- PNG screenshots (background-only and full):
  - Command: `npm run screenshot`
  - Output: `screenshots/mario_bg.png`, `screenshots/mario_full.png` (requires a local .nes in repo root; selection prefers filenames starting with `mario`)
- Animated GIF (optional):
  - If you have ffmpeg installed and PNG frames for a given scene, you can create a GIF, e.g.:
    - `ffmpeg -y -framerate 60 -i screenshots/zelda_%04d.png -vf "scale=512:480:flags=neighbor" -loop 0 screenshots/zelda_title.gif`
  - Note: No game ROMs are provided; generating a Zelda title GIF requires you to supply your own Zelda ROM and a small capture script to dump PNG frames. See tests/slow/harness/screenshot.test.ts for PNG generation patterns you can adapt.

Instrumentation and diagnostics
- Set `PPU_TRACE=1` to capture recent A12 rising edges (with deglitch filter) for analysis.
- Set `MMC3_TRACE=1` to record mapper register writes and A12-driven counter activity (trace growth is bounded to avoid perf issues).
- Many ROM harnesses auto-dump helpful context on failure (CPU tail PCs/opcodes, framebuffer CRC, state sample CRC, A12/mapper trace heads).

Browser host (Web)
- Architecture
  - Dedicated Worker runs the emulator core (CPU/PPU/APU/mappers)
  - AudioWorklet consumes audio from a SharedArrayBuffer ring buffer (mono interleaved frames), duplicating to stereo at output
  - Main thread paints a 256×240 indexed framebuffer to a 2D canvas using a NES palette
- Requirements
  - Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp (Vite dev/preview configured)
- Diagnostics overlay: add `?stats=1` to the URL
  - Shows worklet/worker occupancy, underruns, pump cadence, FPS, and draw cost
- Runtime flags (URL query)
  - `fastdraw=1` — Draw frames immediately on arrival (lowest display/input latency; may tear)
  - `lowlat=1` — Lower default target audio buffer (768 frames) for reduced audio latency
  - `fill=NNN` — Force target audio buffer frames (e.g., `fill=640`, `768`, `896`, `1024`)
  - APU/PPU tuning: `timing=legacy`, `region=pal|ntsc`, `apu_timing=fractional|integer`, `apu_synth=blep|raw`
- Notes
  - SMB1 runs at 60 FPS with clean audio by default
  - SMB3 is heavier (MMC3 IRQ activity). Use the flags above to tailor latency vs headroom per device/browser

Architecture layout
- src/core/cpu: 6502 core (no decimal), official + common unofficial opcodes, branch/page-cross timing, IRQ/NMI
- src/core/ppu: RP2C02 features including VT sampling, odd-frame cycle skip, copyX/copyY windows, sprite evaluation, palette mirroring
- src/core/apu: frame counter (4/5-step), envelopes, length/sweep, triangle/noise/DMC, simple mixer
- src/core/cart: iNES loader, mappers (NROM, UxROM, CNROM, MMC1, MMC3)
- src/core/system: glue tying CPU/PPU/APU/mapper and IO, cycle stepping, IRQ/NMI delivery
- src/host/browser: Web harness (Dedicated Worker + AudioWorklet + SAB ring buffer), 2D canvas renderer, diagnostics overlay
- tests/*: exhaustive CPU/APU/PPU/mappers unit tests and ROM-driven harnesses (SMB/SMB3)

Development workflow
- Lint: `npm run lint`
- Format: `npm run format`
- Build core: `npm run build`
- Fast inner loop: run specific tests via `vitest run tests/path/to/test.ts`
- Add or update baselines using provided scripts under `scripts/*` (do not commit ROMs)

Licensing and ROM policy
- Do not commit commercial game ROMs. Use publicly redistributable test ROMs only, or point tests to local paths via environment variables.
- The code in this repository is provided under an open-source license (see LICENSE if present). ROMs remain the property of their respective rights holders.

Known limitations
- MMC3: a few edge-case timing bugs remain (documented in tests); accuracy work is ongoing
- Browser host: latency/tearing tradeoffs are configurable at runtime (see `fastdraw`, `fill`, `lowlat`) and may need per-device tuning
- Audio: the harness prioritizes zero dropouts; for the lowest-possible latency, reduce `fill` and enable `fastdraw`, balancing against underrun risk

Authorship & provenance
- Authors: gpt-5 (high reasoning), opus 4, Cursor Auto
- Provenance: no human has written a line of code in this repository; development, refactors, and harness tuning were performed autonomously by AI tools
- Workflow: changes land via diffs with automated local verification; tests are the source of truth

Acknowledgements
- The NES community and docs (e.g., nesdev wiki) for public information on hardware behavior, timing, and mappers.
- Open-source authors of public test ROMs used for CPU/APU/PPU/mappers validation.
