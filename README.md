# ai-nes-gpt5

This repository contains a test-first NES emulator in TypeScript. Manual testing is deferred until automated quality gates are green (see PLAN.md).

Quick start
- Install: `npm install`
- Run tests: `npm test`
- Build: `npm run build`
- Fetch test ROMs: `npm run fetch:roms` (configure URLs in scripts/fetch-roms.mjs or place files in ./roms)

Testing with external ROMs
- nestest (CPU): place `roms/nestest.nes` and `roms/nestest.log` and run `NESTEST=1 npm test -- -t "nestest"` or `NESTEST=1 npm test -- -t "nestest cycles"` for cycle checks.
- blargg tests: set `BLARGG=1` and either `BLARGG_ROM=/path/to/single.nes` for the single-ROM harness, or `BLARGG_DIR=/path/to/dir` for the suite aggregator. Optional: `BLARGG_TIMEOUT=50000000` to override cycle timeout.
- Deterministic CRC smoke: drop a `.nes` in the repo root (prefers mario*.nes) and run `npm test` to see a stable CRC in the logs; set `CRC_BASELINE=0xDEADBEEF` to assert against a baseline.

Project structure
- src/core: headless emulator core (CPU, PPU, APU, bus, cartridge)
- src/host: adapters for keyboard, audio, video (later phases)
- tests: unit and integration tests, including ROM harnesses
- roms: test ROMs directory (gitignored)

Licensing note: Do not commit commercial game ROMs. Only use publicly redistributable test ROMs.
