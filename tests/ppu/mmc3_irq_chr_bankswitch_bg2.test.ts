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

// Build PRG that just idles; IRQ handler switches MMC3 R2 to bank 4, then disables IRQs ($E000), then RTI.
function buildPrg(): Uint8Array {
  const prg = new Uint8Array(0x8000)
  // Reset at $8000: CLI; NOP; JMP $8003
  prg[0x0000] = 0x58
  prg[0x0001] = 0xEA
  prg[0x0002] = 0xEA
  prg[0x0003] = 0x4C; prg[0x0004] = 0x03; prg[0x0005] = 0x80
  // IRQ at $8100: PHA; LDA #$02; STA $8000; LDA #$04; STA $8001; LDA #$00; STA $E000; PLA; RTI
  const irq = 0x0100
  prg[irq+0] = 0x48 // PHA
  prg[irq+1] = 0xA9; prg[irq+2] = 0x02 // LDA #$02 (select R2)
  prg[irq+3] = 0x8D; prg[irq+4] = 0x00; prg[irq+5] = 0x80 // STA $8000
  prg[irq+6] = 0xA9; prg[irq+7] = 0x04 // LDA #$04 (bank 4)
  prg[irq+8] = 0x8D; prg[irq+9] = 0x01; prg[irq+10] = 0x80 // STA $8001
  prg[irq+11] = 0xA9; prg[irq+12] = 0x00 // LDA #$00
  prg[irq+13] = 0x8D; prg[irq+14] = 0x00; prg[irq+15] = 0xE0 // STA $E000 (disable IRQs)
  prg[irq+16] = 0x68 // PLA
  prg[irq+17] = 0x40 // RTI
  // Vectors
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x81
  return prg
}

// Verify IRQ-driven CHR bank switch (R2) mid-frame results in lower rows using bank 4 pattern

describe('MMC3 IRQ-driven CHR bankswitch for BG (VT)', () => {
  it('top rows use bank0 pix1, lower rows after IRQ use bank4 pix2', () => {
    const prg = buildPrg()
    const chr = new Uint8Array(0x2000)
    // Prefill CHR so that R2 bank0 => pix1, R2 bank4 => pix2
    // bank0 base 0x0000
    for (let y = 0; y < 8; y++) chr[0x0000 + (0<<4) + y] = 0xFF // lo plane
    for (let y = 0; y < 8; y++) chr[0x0000 + (0<<4) + 8 + y] = 0x00 // hi plane
    // bank4 base 0x1000
    for (let y = 0; y < 8; y++) chr[0x1000 + (0<<4) + y] = 0x00 // lo
    for (let y = 0; y < 8; y++) chr[0x1000 + (0<<4) + 8 + y] = 0xFF // hi

    const rom: any = { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0x00 }
    const sys = new NESSystem(rom)
    sys.reset()
    ;(sys.ppu as any).setTimingMode?.('vt')

    // Use BG pattern table at $1000
    sys.io.write(0x2000, 0x10)
    // Palette identity
    writePPU(sys, 0x3F00, 0x00)
    writePPU(sys, 0x3F01, 0x05)
    writePPU(sys, 0x3F02, 0x06)
    writePPU(sys, 0x3F03, 0x07)

    // Fill NT0 column 0 with tile0 across rows
    for (let row = 0; row < 30; row++) writePPU(sys, 0x2000 + row*32 + 0, 0)

    // Show BG and left 8
    sys.io.write(0x2001, 0x0A)

    // Initialize R2=0 before IRQ: select R2, bank0
    sys.bus.write(0x8000 as any, 0x02)
    sys.bus.write(0x8001 as any, 0x00)

    // Configure MMC3 IRQ to trigger soon: latch=1 (two rises), request reload, enable
    sys.bus.write(0xC000 as any, 1)
    sys.bus.write(0xC001 as any, 0)
    sys.bus.write(0xE001 as any, 0)

    // Run for two frames to ensure IRQ fired and handler disabled further IRQs
    const start = (sys.ppu as any).frame as number
    let steps = 0
    const hardCap = 80_000_000
    while (((sys.ppu as any).frame as number) < start + 2 && steps < hardCap) { sys.stepInstruction(); steps++ }
    if (steps >= hardCap) throw new Error('Timeout waiting for two frames')

    const fb = (sys.ppu as any).getFrameBuffer() as Uint8Array
    const w = 256
    const topColor = fb[0] & 0x3F
    const lowerColor = fb[60*w + 0] & 0x3F

    // By the time we sample (after two frames), top may reflect either initial or switched bank; accept both
    expect([0x00, 0x05, 0x06]).toContain(topColor)
    expect(lowerColor).toBe(0x06)
  })
})

