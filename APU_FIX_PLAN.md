# APU Fix & Accuracy Plan (Checklist)

Immediate high-value fixes
- [x] Noise channel output polarity
  - [x] Flip noise output so bit0==1 yields silence, bit0==0 yields envelope/constant volume
  - [x] Add unit test ensuring output is lower when bit0==1 than when bit0==0
- [x] Pulse sweep unit: mute and edge correctness
  - [x] Compute sweep target and set a per-channel mute flag when target > 0x7FF or target < 8 (only when sweep enabled and shift>0)
  - [x] Preserve “reload only on first half-frame” behavior; maintain divider semantics consistent with period P causing P+1 interval
  - [x] Clear mute when sweep disabled or shift==0
  - [x] Add unit tests for overflow-mute and target<8 mute cases
- [x] System reset must reset APU
  - [x] Call apu.reset() in NESSystem.reset()
  - [ ] Add a sanity test around system reset behavior if needed
- [ ] Non-linear mixer (prepare, may be split if needed)
  - [x] Implement NES non-linear mixer equations (pulse_out and tnd_out)
  - [x] Map to existing 8-bit sample return without changing host paths; preserve 128 baseline
  - [x] Add unit tests validating numeric outputs for representative channel values
  - [x] Add DC-block filter in host audio worker (low-cut); low-pass filter TBD

DMC timing and behavioral fidelity
- [x] CPU stall timing during DMC fetches
  - [x] Add APU→CPU stall hook (approx. 4 cycles per fetch) and apply in system step
  - [ ] Micro-tests verifying instruction elongation during active DMC
  - [ ] ROM tests: dmc_dma_timing, dmc_irq_timing
- [ ] DMC output/edge cases
  - [ ] $4011 DAC write behavior during playback
  - [ ] Empty buffer behavior and one-byte loop quirks
  - [ ] Prefetch/restart timing refinements

Frame counter timing precision
- [ ] Fractional-cycle sequencer edges
  - [x] Add configurable timing mode hook (integer vs fractional placeholder)
  - [ ] Replace integer tick edges with fractional (e.g., 3729.5, 7456.5, …)
  - [ ] Verify $4017 write side-effects (immediate quarter+half clocks for 5-step) and IRQ inhibit/clear
  - [ ] Add micro-tests for edge timing and write-in-sequence cases

Anti-aliasing and resampling
- [ ] Band-limited synthesis
  - [ ] Integrate minBLEP or blip-buffer to reduce aliasing for pulse/triangle/noise steps
  - [ ] Add spectral tests (FFT-based) to verify alias band power < threshold
- [ ] High-quality resampler
  - [ ] Polyphase windowed-sinc (8–16 taps, 64+ phases)
  - [ ] Bit-identical outputs across runs; unit tests for resampling correctness

PAL support
- [x] Add region configuration plumbing and PAL table scaffolding
- [ ] Replace placeholders with proper PAL tables and frame sequencer timings
- [ ] Run a subset of tests in PAL mode (or SpecAPU PAL comparison)

Channel audits and tests
- [ ] Pulse channel
  - [ ] Duty sequences, period write ordering (low/high), timer reload timing
  - [ ] Confirm phase behavior on timer high write (avoid forced reset unless spec)
- [ ] Triangle channel
  - [ ] Linear counter reload semantics, period floor handling, timer gating exactness
- [ ] Noise channel
  - [ ] Validate envelope integration and mode bit tap selection
- [ ] DMC channel
  - [ ] End-to-end behavior, IRQ, loop, prefetch timing, DAC writes

Test coverage addenda
- [ ] Noise polarity test (bit0==1 silent)
- [ ] Sweep mute tests (overflow and target<8)
- [ ] Frame sequencer fractional timing tests
- [ ] DMC stall micro-tests
- [ ] Mixer numeric tests (non-linear), plus simple spectral checks once anti-aliasing lands

Documentation and ergonomics
- [x] docs/apu-spec.md (spec summary and constants) — updated with mixer, DC-block, and timing notes
- [x] src/apu/constants.ts (NTSC/PAL tables, length table, duty tables) — NTSC shipped; PAL placeholders added
- [ ] Developer docs: running APU tests and interpreting failures

