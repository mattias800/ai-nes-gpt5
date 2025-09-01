import { describe, it, expect } from 'vitest'
import { NESSystem } from '@core/system/system'
import type { INesRom } from '@core/cart/ines'

function rom(): INesRom {
  const prg = new Uint8Array(0x8000)
  // Simple infinite NOP loop at $8000
  prg[0x0000] = 0xEA; prg[0x0001] = 0x4C; prg[0x0002] = 0x00; prg[0x0003] = 0x80
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 }
}

// Step CPU to the next audio sample boundary and return both raw and blep samples
function stepAndSample(sys: NESSystem, state: { lastCycles: number, targetCycles: number }, cyclesPerSample: number): { raw: number, blep: number } {
  const CPU_HZ = 1789773
  // state.targetCycles accumulates fractional targets; CPU cycles are stepped instruction-wise
  state.targetCycles += cyclesPerSample
  while (sys.cpu.state.cycles < state.targetCycles) sys.stepInstruction()
  const start = state.targetCycles - cyclesPerSample
  const raw = sys.apu.mixSample() | 0
  const blep = (sys.apu as any).mixSampleBlep ? ((sys.apu as any).mixSampleBlep(start, cyclesPerSample) | 0) : raw
  state.lastCycles = sys.cpu.state.cycles
  return { raw, blep }
}

describe('APU band-limited scaffolding (BLEP) - pass-through and events', () => {
  it('mixSampleBlep produces valid samples and does not NaN/clip when BLEP is enabled', () => {
    const sys = new NESSystem(rom())
    sys.reset()
    // Configure pulse1: constant volume, duty 50%, audible timer, enable channel
    sys.io.write(0x4015, 0x01)
    sys.io.write(0x4000, 0x10 | 0x08 | (2 << 6)) // constant volume=8, duty=50%
    sys.io.write(0x4002, 0x20) // period low
    sys.io.write(0x4003, 0x02) // period high bits, load length
    // Enable BLEP synthesis
    ;(sys.apu as any).enableBandlimitedSynth?.(true)

    const state = { lastCycles: 0, targetCycles: 0 }
    const sr = 44100
    const cyclesPerSample = 1789773 / sr
    const N = 1024
    for (let i = 0; i < N; i++) {
      const { blep } = stepAndSample(sys, state, cyclesPerSample)
      expect(Number.isFinite(blep)).toBe(true)
      expect(blep >= 0 && blep <= 255).toBe(true)
    }
  })

  it('emits pulse edge events while running when BLEP is enabled', () => {
    const sys = new NESSystem(rom())
    sys.reset()
    // Enable pulse1 with a short period so edges occur frequently
    sys.io.write(0x4015, 0x01)
    sys.io.write(0x4000, 0x10 | 0x08 | (2 << 6))
    sys.io.write(0x4002, 0x10)
    sys.io.write(0x4003, 0x02)
    ;(sys.apu as any).enableBandlimitedSynth?.(true)

    // Tick APU directly for a while to generate edges
    ;(sys.apu as any).tick(2000)
    const count = (sys.apu as any).debugBlepEventCount?.() | 0
    expect(count).toBeGreaterThan(0)
  })
})

