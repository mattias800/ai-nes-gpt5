import { describe, it, expect } from 'vitest'
import { PPU } from '@core/ppu/ppu'

function writeAddr(ppu: PPU, addr: number) {
  ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF)
  ppu.cpuWrite(0x2006, addr & 0xFF)
}
function writePPU(ppu: PPU, addr: number, val: number) {
  writeAddr(ppu, addr)
  ppu.cpuWrite(0x2007, val & 0xFF)
}

describe('PPUCTRL base nametable mid-scanline change (VT)', () => {
  it('mid-scanline $2000 write changes base NT only from next scanline onward', () => {
    const ppu = new PPU(); ppu.reset(); ppu.setTimingMode('vt')

    // CHR: tile 1 pix=1; tile 2 pix=2
    const chr = new Uint8Array(0x2000)
    for (let y = 0; y < 8; y++) chr[(1<<4)+y] = 0xFF
    for (let y = 0; y < 8; y++) chr[(2<<4)+8+y] = 0xFF
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF })

    // Palette identity
    writePPU(ppu, 0x3F00, 0x00)
    writePPU(ppu, 0x3F01, 0x01)
    writePPU(ppu, 0x3F02, 0x02)
    writePPU(ppu, 0x3F03, 0x03)

    // NT $2000 col0 = tile1 across rows; NT $2400 col0 = tile2 across rows
    for (let row = 0; row < 30; row++) {
      writePPU(ppu, 0x2000 + row*32 + 0, 1)
      writePPU(ppu, 0x2400 + row*32 + 0, 2)
    }

    // Start with base NT = $2000
    ppu.cpuWrite(0x2000, 0x00)
    // Enable BG + show left
    ppu.cpuWrite(0x2001, 0x0A)

    // Advance to visible scanline 20
    for (let sl = 0; sl < 20; sl++) ppu.tick(341)
    // Render entire scanline 20
    for (let x = 0; x < 256; x++) ppu.tick(1)
    const fb1 = (ppu as any).getFrameBuffer() as Uint8Array
    const c20 = fb1[20*256 + 0] & 0x3F

    // On scanline 21, mid-scanline change base NT X to 1 ($2400)
    // Run to cycle ~100, then write $2000 with base NT X=1
    ppu.tick(100)
    ppu.cpuWrite(0x2000, 0x01)
    // Complete rest of scanline 21
    ppu.tick(341 - 100)
    // Render entire scanline 22
    ppu.tick(341)

    const fb2 = (ppu as any).getFrameBuffer() as Uint8Array
    const c21 = fb2[21*256 + 0] & 0x3F
    // Next scanline 22 should reflect new base NT
    const c22 = fb2[22*256 + 0] & 0x3F

    // Expectations:
    // - c20 was from NT0 -> color 1
    // - c21 should still be from NT0 (change takes effect next line) -> color 1
    // - c22 should be from NT1 -> color 2
    expect(c20).toBe(1)
    expect(c21).toBe(1)
    expect(c22).toBe(2)
  })
})

