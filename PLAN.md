# NES Emulator (TypeScript) — Automated, No-Manual-Testing Plan

Goal
- Build a Nintendo NES emulator in TypeScript that runs Super Mario Bros. 3 (MMC3), with keyboard input and audio output.
- Achieve high confidence via automated tests only. No manual testing until all quality gates are green.

Principles
- Test-first increments: Every subsystem is driven by public, widely used test ROMs and unit tests.
- Deterministic execution: CPU, PPU, and APU cycles advance deterministically in the test harness.
- No UI dependencies in core: The emulator core is a headless library. Browser UI (keyboard/audio) is an adapter layer, tested with unit/integration hooks.
- Continuous verification: After each unit of work, run tests and commit with a detailed summary.

High-Level Architecture
- Core
  - CPU (RP2A03/6502 without decimal mode)
  - PPU (RP2C02) with rendering pipeline and OAM DMA
  - APU (audio synthesis) with channels (pulse1, pulse2, triangle, noise, DMC) and mixer
  - Memory Bus + DMA + timing
  - Cartridge loader (iNES/NES 2.0), mappers: NROM, UxROM, CNROM, MMC1, MMC3 (required for SMB3)
  - Controllers (standard joypads)
- Host Adapters (separate packages/modules)
  - Keyboard input (mapping to controllers)
  - Audio output (WebAudio in browser, Node mock for tests)
  - Video output (offscreen framebuffer; browser adapter draws to canvas)

Automated Test Strategy
- CPU
  - nestest: Instruction-by-instruction log comparison against nestest.log (ignore PPU/CYC columns, assert PC,A,X,Y,P,SP match per step)
  - blargg CPU tests (if available): PASS/FAIL written to $6000-$7FFF; test harness polls/watches writes and asserts PASS
- PPU
  - PPU register and NMI behavior: Known PPU tests (vbl_nmi, nmi_timing, sprite hit tests). Harness runs frames until a signature is emitted to RAM and/or a known flag is set
  - Rendering determinism: Framebuffer CRC for specific PPU test ROMs that produce deterministic output
  - OAM DMA: DMA write behavior and cycle timing tests
- Mappers
  - NROM smoke tests (simple ROMs)
  - MMC1 basic bank switching tests
  - MMC3 IRQ timing tests (critical for SMB3): Run standard MMC3 IRQ test ROMs and assert PASS via RAM signature
- APU
  - blargg APU tests: PASS/FAIL RAM signature; optional audio sample golden checks for shorter windows
- Controllers
  - Unit tests for shift-register behavior on $4016/$4017; deterministic read sequences

ROM Test Harness Conventions
- iNES loader supports PRG/CHR ROM and PRG RAM
- Emulation loop: cycle-accurate stepping of CPU and PPU/APU. For tests that don’t require full PPU/APU, stubs simulate minimal behavior
- PASS/FAIL Detection: For blargg-style tests, capture writes in $6000-$7FFF and parse ASCII messages or PASS flags (without user interaction)
- Guardrails: Each test has a cycle limit/frame limit to avoid infinite loops

Quality Gates (Confidence for SMB3)
We will consider the emulator ready for manual trial only when all of the following are green:
1) CPU
   - nestest instruction log comparison fully matches across the provided trace
   - blargg CPU tests (if fetched) all PASS
2) PPU
   - VBlank/NMI timing tests pass
   - Sprite 0 hit and sprite overflow tests pass (as applicable for RP2C02)
   - Scrolling and rendering determinism tests pass with expected CRCs
3) Mappers
   - NROM, UxROM, CNROM, MMC1: basic bank tests pass
   - MMC3 IRQ timing tests pass (ensures SMB3 scroll IRQs work)
4) APU
   - blargg APU tests pass (including length/envelope/sweep behaviors)
5) Controller
   - Controller shift-register tests pass
6) SMB3 smoke test (optional if ROM is present)
   - Headless run to title screen for N frames, comparing one or more frame CRCs to known references

Planned Work Breakdown
Phase 0 — Scaffolding
- Project setup: TypeScript, test runner, strict config, CI-ready scripts
- Test ROMs fetch script and storage under tests/resources
- Minimal headless harness framework

Phase 1 — CPU + Bus + NROM
- Memory bus with 2KB RAM mirrors, PRG RAM, PPU/APU/IO placeholders
- iNES loader for PRG/CHR
- CPU (official opcodes, all addressing modes, interrupts, page-cross handling, decimal disabled)
- nestest harness and test to compare CPU registers per-step using nestest.log
- Target: Full match

Phase 2 — PPU (Foundations)
- PPU register interface $2000-$2007, scroll/addr latches, increment behavior
- NMI generation and VBlank timing
- OAM DMA ($4014) and OAM memory
- Basic rendering pipeline: background fetch, nametables, attribute tables, pattern tables, palette
- Tests: vbl_nmi, nmi_timing, sprite hit/overflow

Phase 3 — Mappers (baseline)
- NROM fully verified
- UxROM, CNROM, MMC1; tests for bank switching

Phase 4 — MMC3
- Implement scanline counter and IRQs; verify with MMC3 IRQ tests

Phase 5 — APU
- Channel implementations and frame counter
- Tests via blargg APU suite; optional golden-sample equivalence for short windows

Phase 6 — Controllers + Integration
- Controller read behavior tests
- Headless end-to-end tests for deterministic ROM outputs (framebuffer CRCs)

Phase 7 — UI Adapters (no manual testing yet)
- Keyboard adapter (unit tests for mapping only)
- Audio adapter (unit tests using offline audio graph mocks)

How We’ll Avoid Manual Testing
- Every subsystem has deterministic tests
- Headless harness with PASS/FAIL signals or frame CRCs
- No UI interaction is required to evaluate correctness

SMB3 Readiness Criteria
- All quality gates green (CPU/PPU/APU/Mapper/controller tests)
- MMC3 IRQ tests all PASS
- Optional: SMB3 title-screen frame CRC(s) match known references after N frames (if ROM supplied locally)

Operational Notes
- Licensing: Do not commit copyrighted game ROMs. Test ROMs used here are public test assets; verify licenses and only fetch from public sources
- Performance: While correctness-first, keep cycle stepping efficient. Optimize only after tests pass
- Persistence: Optional save states (serialization) can aid additional automated tests later

Appendix: Initial Test ROMs To Fetch
- nestest.nes and nestest.log (for CPU)
- blargg CPU tests (if available)
- PPU timing/sprite tests
- MMC3 IRQ tests
- blargg APU tests

Implementation starts with Phase 0/1.

