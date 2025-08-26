# ai-nes-gpt5

This repository contains a test-first NES emulator in TypeScript. Manual testing is deferred until automated quality gates are green (see PLAN.md).

Quick start
- Install: `npm install`
- Run full verification (VT timing): `npm run verify`
- Run tests (VT timing): `npm test`
- Build: `npm run build`
- Fetch test ROMs: `npm run fetch:roms` (configure URLs in scripts/fetch-roms.mjs or place files in ./roms)

Notes on accuracy
- Tests default to PPU_TIMING_DEFAULT=vt for higher timing accuracy. You can override per run by setting the env var.

Testing with external ROMs
- nestest (CPU): place `roms/nestest.nes` and `roms/nestest.log` and run `NESTEST=1 npm test -- -t "nestest"` or `NESTEST=1 npm test -- -t "nestest cycles"` for cycle checks.
- blargg tests: set `BLARGG=1` and either `BLARGG_ROM=/path/to/single.nes` for the single-ROM harness, or `BLARGG_DIR=/path/to/dir` for the suite aggregator. Optional: `BLARGG_TIMEOUT=50000000` to override cycle timeout.
- Deterministic CRC smoke: drop a `.nes` in the repo root (prefers mario*.nes) and run `npm test` to see a stable CRC in the logs; set `CRC_BASELINE=0xDEADBEEF` to assert against a baseline.

Super Mario Bros deterministic baseline (optional)
- Place an SMB ROM locally (do not commit). Preferred: `mario*.nes` in repo root or `./roms`, or set `SMB_ROM=/absolute/path/to/mario.nes`.
- Record baseline: `npm run baseline:smb` (defaults to 60 frames and VT timing). You can pass flags, e.g., `npm run baseline:smb -- --frames=120 --rom=/path/to/mario.nes`.
- After recording, the test `[@smb-baseline] SMB deterministic CRC (boot)` will assert deterministically when the ROM is present.

Super Mario Bros 3 deterministic baselines (optional)
- Place an SMB3 ROM locally (do not commit). Preferred names: smb3*.nes, mario3*.nes. Or set `SMB3_ROM=/absolute/path/to/smb3.nes`.
- Record baselines (title + deep): `npm run baseline:smb3` with optional flags `--title-frames=120 --deep-frames=600 --rom=/path/to/smb3.nes`.
- Once recorded, the SMB3 title and deep CRC tests will assert deterministically when the ROM is present.

Project structure
- src/core: headless emulator core (CPU, PPU, APU, bus, cartridge)
- src/host: adapters for keyboard, audio, video (later phases)
- tests: unit and integration tests, including ROM harnesses
- roms: test ROMs directory (gitignored)

Licensing note: Do not commit commercial game ROMs. Only use publicly redistributable test ROMs.

CI: intentionally removed
- GitHub Actions workflows are intentionally removed; all verification is local via the scripts above.
