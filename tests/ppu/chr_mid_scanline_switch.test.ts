import { describe, it, expect } from 'vitest'
import { PPU } from '@core/ppu/ppu'
import { MMC3 } from '@core/cart/mappers/mmc3'

function writeAddr(ppu: PPU, addr: number) {
  ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF)
  ppu.cpuWrite(0x2006, addr & 0xFF)
}
function writePPU(ppu: PPU, addr: number, val: number) {
  writeAddr(ppu, addr)
  ppu.cpuWrite(0x2007, val & 0xFF)
}

// Verify CHR bank switch mid-scanline does not retroactively change pixels already drawn

describe('PPU CHR bank switch mid-scanline stability', () => {
  it('switching MMC3 R2 mid-scanline affects later pixels only (earlier pixels remain as drawn)', () => {
    const ppu = new PPU('vertical')
    ppu.reset()
    ppu.setTimingMode('vt')

    // MMC3 with 8KB CHR RAM; build two distinct patterns for tile 0
    const prg = new Uint8Array(16 * 0x4000)
    const chr = new Uint8Array(0x2000)
    // Bank 0: lo plane 0xFF, hi plane 0x00 -> color index 1
    for (let y = 0; y < 8; y++) chr[0x0000 + (0<<4) + y] = 0xFF
    for (let y = 0; y < 8; y++) chr[0x0000 + (0<<4) + 8 + y] = 0x00
    // Bank 4 (offset 0x1000): lo plane 0x00, hi plane 0xFF -> color index 2
    for (let y = 0; y < 8; y++) chr[0x1000 + (0<<4) + y] = 0x00
    for (let y = 0; y < 8; y++) chr[0x1000 + (0<<4) + 8 + y] = 0xFF

    const mmc3 = new MMC3(prg, chr)
    ppu.connectCHR((a) => mmc3.ppuRead(a), (a, v) => mmc3.ppuWrite(a, v))

    // Use BG pattern table at $1000 so R2 mapping controls visible
    ppu.cpuWrite(0x2000, 0x10)

    // Palette: 1->0x05, 2->0x06
    writePPU(ppu, 0x3F00, 0x00)
    writePPU(ppu, 0x3F01, 0x05)
    writePPU(ppu, 0x3F02, 0x06)

    // Fill row 0 with tile 0 across the full width
    for (let col = 0; col < 32; col++) writePPU(ppu, 0x2000 + col, 0)

    // Enable BG and left 8
    ppu.cpuWrite(0x2001, 0x0A)

    // Initialize R2=0 (bank 0)
    mmc3.cpuWrite(0x8000, 0x02) // select R2
    mmc3.cpuWrite(0x8001, 0x00) // bank 0

    // Draw first half of scanline 0
    ppu.tick(1 + 128) // cycles 0..128 -> pixels up to x=127 drawn

    // Mid-scanline switch R2 to bank 4
    mmc3.cpuWrite(0x8000, 0x02)
    mmc3.cpuWrite(0x8001, 0x04)

    // Finish the scanline
    ppu.tick(341 - (1 + 128))

    const fb = (ppu as any).getFrameBuffer() as Uint8Array
    const w = 256
    const left = fb[0 * w + 0] & 0x3F
    const right = fb[0 * w + 200] & 0x3F

    // Left pixel drawn before switch -> color from bank0 (0x05)
    // Right pixel drawn after switch -> color from bank4 (0x06)
    expect(left).toBe(0x05)
    expect(right).toBe(0x06)
  })
})

