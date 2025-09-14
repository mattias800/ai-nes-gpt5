import { describe, it, expect } from 'vitest'
import { MMC5 } from '@core/cart/mappers/mmc5'

const prg = new Uint8Array(0x20000)
const chr = new Uint8Array(0x2000)

const makeSysTime = (s: number, c: number) => ({ frame: 0, scanline: s, cycle: c })

describe('MMC5 IRQ compare ($5203/$5204)', () => {
  it('asserts IRQ at start of matching scanline when enabled', () => {
    const m = new MMC5(prg, chr)
    let t = makeSysTime(0, 0)
    m.setTimeProvider(() => t)

    // Program compare line to 100 and enable IRQ
    m.cpuWrite(0x5203, 100)
    m.cpuWrite(0x5204, 0x80) // enable

    // Before compare: no IRQ
    t = makeSysTime(99, 0)
    m.tick(1)
    expect(m.irqPending()).toBe(false)

    // At compare line but not at cycle 0: no IRQ yet
    t = makeSysTime(100, 10)
    m.tick(1)
    expect(m.irqPending()).toBe(false)

    // At cycle 0 of compare line: IRQ asserted
    t = makeSysTime(100, 0)
    m.tick(1)
    expect(m.irqPending()).toBe(true)

    // Reading status reflects IRQ bit (bit7)
    const stat = m.cpuRead(0x5204)
    expect((stat & 0x80) !== 0).toBe(true)

    // Clear via mapper clearIrq
    m.clearIrq()
    expect(m.irqPending()).toBe(false)
  })
})

