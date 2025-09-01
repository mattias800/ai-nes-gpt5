# NES APU Behavioral Notes (NTSC)

This document summarizes the main behaviors used/targeted by the APU implementation and tests.

Channels and units
- Pulse 1/2
  - Duty sequences: [12.5%, 25%, 50%, 75%] with 8-step sequences.
  - Envelope: divider reload to (period+1), volume 15 on start; optional loop; constant-volume when bit4 set.
  - Length counter: decremented on half-frame (when not halted); cleared when channel disabled via $4015.
  - Sweep: divider period (P+1); ones-complement quirk on pulse1 negate (delta+1); mute when target > 0x7FF or target < 8.
  - Timer: period must be > 7 to produce output.
- Triangle
  - Linear counter reload flag and control (halt) gating.
  - Timer advances only when length>0 and linear>0; period must be > 1.
- Noise
  - 15‑bit LFSR, bit0 XOR (bit1 or bit6 in short mode).
  - Output is 0 when LFSR bit0==1; otherwise envelope/constant volume.
  - NTSC periods per NOISE_PERIODS_NTSC.
- DMC
  - Rate table per DMC_PERIODS_NTSC; bit engine shifts LSB first, +2/-2 DAC steps; clamp 0..127.
  - Sample buffer prefetched at bit exhaustion; optional loop; IRQ when length depletes and IRQ enabled.

Frame counter
- 4-step and 5-step sequences; quarter-frame (envelope/linear) on each step; half-frame (length/sweep) on specific steps.
- In 4-step mode, IRQ asserted at end of sequence when not inhibited; $4015 read clears the flag.
- Writing $4017 with bit7=1 (5-step) triggers immediate quarter+half clocks.

Mixer
- Non-linear approximation per NESdev:
  - pulse_out = 95.88 / (8128/(p1+p2) + 100)
  - tnd_out = 159.79 / (1 / (tri/8227 + noise/12241 + dmc/22638) + 100)
- Implementation maps pulse_out + tnd_out (≈[0,1)) to an 8-bit centered sample: 128 + out*127.
- Host audio path applies a simple DC-block filter y[n] = x[n] - x[n-1] + R·y[n-1] (R≈0.999).

Band-limited synthesis (feature-flagged)
- When enabled, pulse channel duty transitions and DMC DAC steps are logged with CPU-cycle timestamps and a BLEP renderer smooths these discontinuities at audio sample time to reduce aliasing.
- The current implementation uses a lightweight polyBLEP kernel with per-channel dt (frequency/sampleRate) derived from timer periods: pulses use dt ≈ cyclesPerSample/(16·(T+1)), DMC uses dt ≈ cyclesPerSample/dmcTimerPeriod.
- Enable via URL parameter apu_synth=blep (or synth=blep). Default is raw.
- Future work: tune kernels and optionally extend to triangle/noise if beneficial; add quality/perf presets.

Registers (subset)
- $4000/$4004: duty/env (bit5=halt/loop, bit4=const, low4=envelope period).
- $4001/$4005: sweep (EPPP NSSS).
- $4002/$4006: timer low; $4003/$4007: length load + timer high; also envelope start.
- $4008/$400A/$400B: triangle linear/timer/length.
- $400C/$400E/$400F: noise envelope, mode/period, length/start.
- $4010-$4013: DMC control/DAC addr/length.
- $4015: enable/status (read clears DMC+frame IRQ flags).
- $4017: frame counter control/inhibit; immediate clocks when bit7=1.

Timing notes
- Frame sequencer supports integer edges (default) and fractional edges with sub-cycle timing:
  - 4-step edges (NTSC/CPU cycles): [3729.5, 7456.5, 11186.5, 14916.5]
  - 5-step edges: [3729.5, 7456.5, 11186.5, 14916.5, 18641.5]
  - Tests verify quarter- and half-frame clocks only occur after crossing these edges, and 5-step sets no frame IRQ.
- DMC DMA stalls: modeled approximately as 4 CPU cycles per sample fetch. These cycles are applied at the system level so CPU/PPU/APU stay in sync. Opt-in via ENABLE_DMC_STALLS=1.
- Region: APU supports a region setting ('NTSC'|'PAL'). PAL DMC table is canonical 2A07; PAL noise table is derived from NTSC periods by CPU frequency scaling (until a verified 2A07 noise table is provided).

Test coverage
- Fractional frame counter: tests in tests/apu/frame_counter_fractional*.test.ts
- BLEP scaffolding: tests in tests/apu/blep_scaffold.test.ts
- DMC stalls (opt-in): tests/integration/apu_dmc_stall.test.ts

Constants location
- src/core/apu/constants.ts exports NTSC period tables and duty sequences; PAL variants selected via region.

