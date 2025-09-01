import { describe, it, expect } from 'vitest'
import { APU } from '@core/apu/apu'

// Basic numeric sanity on non-linear mixer mapping to 8-bit centered output

describe('APU non-linear mixer (8-bit centered)', () => {
  it('silence maps to mid 128; adding pulse raises value', () => {
    const apu = new APU()
    apu.reset()

    // Silence
    let s0 = apu.mixSample()
    expect(s0).toBe(128)

    // Enable pulse1 constant volume=8, duty=50%, timer large enough to be audible
    ;(apu as any).writeRegister(0x4015, 0x01)
    ;(apu as any).writeRegister(0x4000, 0x10 | 0x08 | (2 << 6))
    ;(apu as any).writeRegister(0x4002, 0x40)
    ;(apu as any).writeRegister(0x4003, 0x02)

    // Advance a bit then sample
    apu.tick(1000)
    const s1 = apu.mixSample()
    expect(s1).toBeGreaterThan(128)
  })
})

