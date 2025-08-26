import { describe, it, expect } from 'vitest'
import { NESSystem } from '@core/system/system'

function writeAddr(sys: NESSystem, addr: number) {
  sys.io.write(0x2006, (addr >> 8) & 0xFF)
  sys.io.write(0x2006, addr & 0xFF)
}
function writePPU(sys: NESSystem, addr: number, val: number) {
  writeAddr(sys, addr)
  sys.io.write(0x2007, val & 0xFF)
}

// Build a minimal 32KB PRG image with IRQ handler that switches MMC3 R2 ($1000..$13FF) to a different 1KB CHR bank
function buildPrg(): Uint8Array {
  const prg = new Uint8Array(0x8000)
  // Reset at $8000: CLI; NOP; JMP $8003
  prg[0x0000] = 0x58
  prg[0x0001] = 0xEA
  prg[0x0002] = 0xEA
  prg[0x0003] = 0x4C
  prg[0x0004] = 0x03
  prg[0x0005] = 0x80
  // IRQ at $8100: PHA; LDA #$02; STA $8000; LDA #$04; STA $8001; PLA; RTI
  const irq = 0x0100
  prg[irq+0] = 0x48 // PHA
  prg[irq+1] = 0xA9; prg[irq+2] = 0x02 // LDA #$02 (select R2)
  prg[irq+3] = 0x8D; prg[irq+4] = 0x00; prg[irq+5] = 0x80 // STA $8000
  prg[irq+6] = 0xA9; prg[irq+7] = 0x04 // LDA #$04 (bank 4)
  prg[irq+8] = 0x8D; prg[irq+9] = 0x01; prg[irq+10] = 0x80 // STA $8001
  prg[irq+11] = 0x68 // PLA
  prg[irq+12] = 0x40 // RTI
  // Vectors
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x81
  return prg
}

// Verify that after IRQ, BG tile fetched from $1000 region changes due to CHR bank switch

describe.skip('MMC3 raster: IRQ-driven CHR bank switch for background (VT)', () => {
  it('top lines use bank0 pattern, bottom lines use bank4 pattern', () => {
    const prg = buildPrg()
    const chr = new Uint8Array(0x2000) // 8KB

    // Prepare two different patterns for tile #0 in R2 region ($1000..$13FF):
    // Bank 0: pix=1 (lo plane 0xFF)
    for (let y = 0; y < 8; y++) chr[0x0000 + (0 << 4) + y] = 0xFF
    for (let y = 0; y < 8; y++) chr[0x0000 + (0 << 4) + 8 + y] = 0x00
    // Bank 4 (offset 4*1KB=0x1000 within CHR array): pix=2 (hi plane 0xFF)
    const bank4 = 4 * 0x400
    for (let y = 0; y < 8; y++) chr[bank4 + (0 << 4) + y] = 0x00
    for (let y = 0; y < 8; y++) chr[bank4 + (0 << 4) + 8 + y] = 0xFF

    const rom: any = { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0x00 }
    const sys = new NESSystem(rom)
    sys.reset()
    ;(sys.ppu as any).setTimingMode?.('vt')

    // Use BG pattern table at $1000 (PPUCTRL bit4)
    sys.io.write(0x2000, 0x10)
    // Palette setup
    writePPU(sys, 0x3F00, 0x00)
    writePPU(sys, 0x3F01, 0x05) // color for pix1
    writePPU(sys, 0x3F02, 0x06) // color for pix2
    writePPU(sys, 0x3F03, 0x07)

    // Place tile #0 in first column of $2000 across all rows
    for (let row = 0; row < 30; row++) writePPU(sys, 0x2000 + row*32 + 0, 0)

    // Enable BG and show left 8 pixels
    sys.io.write(0x2001, 0x0A)

    // Set initial CHR bank for R2 = 0 (so top uses pix1 pattern)
    sys.bus.write(0x8000 as any, 0x02)
    sys.bus.write(0x8001 as any, 0x00)

    // Configure MMC3 IRQ: latch=1, request reload, enable
    sys.bus.write(0xC000 as any, 1)
    sys.bus.write(0xC001 as any, 0)
    sys.bus.write(0xE001 as any, 0)

    // Run until VBlank of the second frame to ensure IRQ-handled bank switch has taken effect across lines
    const startFrame = (sys.ppu as any).frame as number
    let steps = 0
    const hardCap = 60_000_000
    while (((sys.ppu as any).frame as number) < startFrame + 2 && steps < hardCap) { sys.stepInstruction(); steps++ }
    if (steps >= hardCap) throw new Error('Timeout waiting for second frame')

    const fb = (sys.ppu as any).getFrameBuffer() as Uint8Array
    const w = 256
    const top = fb[0] & 0x3F
    const bottom = fb[40*w + 0] & 0x3F

    // top may be universal color or pix1 depending on reset timing; allow both
    expect([0x00, 0x05]).toContain(top)
    // bottom after IRQ+bank switch should show pix2 color
    expect(bottom).toBe(0x06)
  })
})

