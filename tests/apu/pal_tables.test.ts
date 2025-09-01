import { describe, it, expect } from 'vitest'
import { APU } from '@core/apu/apu'
import { DMC_PERIODS_PAL, getNoisePeriods } from '@core/apu/constants'

describe('APU PAL tables selection', () => {
  it('uses PAL DMC period table when region set to PAL', () => {
    const apu = new APU()
    apu.reset()
    ;(apu as any).setRegion('PAL')
    // Write $4010 with rate index 15 (0x0F) -> expect PAL period 50
    ;(apu as any).writeRegister(0x4010, 0x0F)
    const dmcTimer = (apu as any)['dmcTimerPeriod']
    expect(dmcTimer).toBe(DMC_PERIODS_PAL[15])
  })

  it('uses PAL noise period table when region set to PAL', () => {
    const apu = new APU()
    apu.reset()
    ;(apu as any).setRegion('PAL')
    // Write $400E with noise period index 15
    ;(apu as any).writeRegister(0x400E, 0x0F)
    const noiseTimer = (apu as any)['noiseTimerPeriod']
    const expected = getNoisePeriods('PAL')[15]
    expect(noiseTimer).toBe(expected)
  })
})

