import { describe, it, expect } from 'vitest'
import { MMC5 } from '@core/cart/mappers/mmc5'

const PRG = new Uint8Array(0x20000)
const CHR = new Uint8Array(0x2000)

describe('MMC5 PRG-RAM control and ExRAM general access', () => {
  it('PRG-RAM enable and write-protect works', () => {
    const m = new MMC5(PRG, CHR)

    // Initially disabled? Our default is enabled=true; force disable to test gate
    m.cpuWrite(0x5101, 0x00) // disable
    m.cpuWrite(0x6000, 0x55)
    expect(m.cpuRead(0x6000)).toBe(0x00)

    // Enable and write
    m.cpuWrite(0x5101, 0x80) // enable
    m.cpuWrite(0x6000, 0x66)
    expect(m.cpuRead(0x6000)).toBe(0x66)

    // Protect and try to write different value
    m.cpuWrite(0x5102, 0x01) // write protect
    m.cpuWrite(0x6000, 0x77)
    // Should remain previous value
    expect(m.cpuRead(0x6000)).toBe(0x66)

    // Unprotect and write new value
    m.cpuWrite(0x5102, 0x00)
    m.cpuWrite(0x6000, 0x88)
    expect(m.cpuRead(0x6000)).toBe(0x88)
  })

  it('ExRAM general: CPU and PPU nametable override access', () => {
    const m = new MMC5(PRG, CHR)

    // CPU writes/reads exram range directly
    m.cpuWrite(0x5C00, 0x42)
    expect(m.cpuRead(0x5C00)).toBe(0x42)

    // Map all NT quadrants to ExRAM (2) and write via PPU NT path
    m.cpuWrite(0x5105, 0xAA)
    // Write a tile value at top-left of NT0
    m.ppuNTWrite(0x2000, 0x37)
    // Attribute area write
    m.ppuNTWrite(0x23C0, 0x9B)

    // Verify via CPU ExRAM window
    expect(m.cpuRead(0x5C00 + 0x000)).toBe(0x37)
    expect(m.cpuRead(0x5C00 + 0x3C0)).toBe(0x9B)

    // Read back via PPU path too
    expect(m.ppuNTRead(0x2000)).toBe(0x37)
    expect(m.ppuNTRead(0x23C0)).toBe(0x9B)
  })
})

