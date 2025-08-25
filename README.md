# ai-nes-gpt5

This repository contains a test-first NES emulator in TypeScript. Manual testing is deferred until automated quality gates are green (see PLAN.md).

Quick start
- Install: `npm install`
- Run tests: `npm test`
- Build: `npm run build`
- Fetch test ROMs: `npm run fetch:roms` (configure URLs in scripts/fetch-roms.mjs or place files in ./roms)

Project structure
- src/core: headless emulator core (CPU, PPU, APU, bus, cartridge)
- src/host: adapters for keyboard, audio, video (later phases)
- tests: unit and integration tests, including ROM harnesses
- roms: test ROMs directory (gitignored)

Licensing note: Do not commit commercial game ROMs. Only use publicly redistributable test ROMs.
