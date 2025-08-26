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

// PRG with IRQ handler: adjust fine X via $2005, then disable IRQs so it triggers once.
function buildPrgScrollOnce(): Uint8Array {
  const prg = new Uint8Array(0x8000)
  // Reset: CLI; NOP; JMP $8003
  prg[0x0000] = 0x58
  prg[0x0001] = 0xEA
  prg[0x0002] = 0xEA
  prg[0x0003] = 0x4C; prg[0x0004] = 0x03; prg[0x0005] = 0x80
  // IRQ at $8100: PHA; LDA #$04; STA $2005; LDA #$00; STA $2005; LDA #$00; STA $E000; PLA; RTI
  const irq = 0x0100
  prg[irq+0] = 0x48
  prg[irq+1] = 0xA9; prg[irq+2] = 0x08
  prg[irq+3] = 0x8D; prg[irq+4] = 0x05; prg[irq+5] = 0x20
  prg[irq+6] = 0xA9; prg[irq+7] = 0x00
  prg[irq+8] = 0x8D; prg[irq+9] = 0x05; prg[irq+10] = 0x20
  prg[irq+11] = 0xA9; prg[irq+12] = 0x00
  prg[irq+13] = 0x8D; prg[irq+14] = 0x00; prg[irq+15] = 0xE0
  prg[irq+16] = 0x68
  prg[irq+17] = 0x40
  // Vectors
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x81
  return prg
}

function runToFirstFrame(sys: NESSystem, cap=30_000_000) {
  const start = (sys.ppu as any).frame as number
  let steps = 0
  while (((sys.ppu as any).frame as number) < start + 1 && steps < cap) { sys.stepInstruction(); steps++ }
  if (steps >= cap) throw new Error('timeout first frame')
}

function runUntilScanline(sys: NESSystem, targetY: number, cap=60_000_000) {
  let steps = 0
  while (((sys.ppu as any).scanline as number) < targetY && steps < cap) { sys.stepInstruction(); steps++ }
  if (steps >= cap) throw new Error('timeout to target scanline')
}

function sampleRow(fb: Uint8Array, y: number, width=32): string {
  const w = 256
  const vals: number[] = []
  for (let x = 0; x < width; x++) vals.push(fb[y*w + x] & 0x3F)
  return vals.join(',')
}

describe.skip('MMC3 IRQ lateness gating for scroll split (VT)', () => {
  it('mid-scanline IRQ $2005 writes do not affect current line and take effect later (gated)', () => {
    const prg = buildPrgScrollOnce()
    const chr = new Uint8Array(0x2000)
    // Two tiles with horizontal variation:
    // tile1: lo plane 11110000 (0xF0) -> pix1 in left half, 0 in right half
    // tile2: lo plane 00001111 (0x0F) -> pix1 in right half, 0 in left half
    for (let y = 0; y < 8; y++) chr[(1<<4)+y] = 0xF0
    for (let y = 0; y < 8; y++) chr[(2<<4)+y] = 0x0F

    // Baseline system without enabling IRQ
    const romBase: any = { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0x00 }
    const base = new NESSystem(romBase)
    base.reset(); (base.ppu as any).setTimingMode?.('vt')
    // Palette identity
    writePPU(base, 0x3F00, 0x00); writePPU(base, 0x3F01, 0x01); writePPU(base, 0x3F02, 0x02); writePPU(base, 0x3F03, 0x03)
    // Vertical stripes 1,2,1,2...
    for (let row = 0; row < 30; row++) for (let col = 0; col < 32; col++) writePPU(base, 0x2000 + row*32 + col, (col & 1) ? 2 : 1)
    base.io.write(0x2001, 0x0A)

    // Run both systems up to a known scanline, then enable IRQ on the second system.
    const targetY = 40
    runUntilScanline(base, targetY)

    const fbBase = (base.ppu as any).getFrameBuffer() as Uint8Array

    // IRQ-enabled system
    const romIRQ: any = { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0x00 }
    const sys = new NESSystem(romIRQ)
    sys.reset(); (sys.ppu as any).setTimingMode?.('vt')
    writePPU(sys, 0x3F00, 0x00); writePPU(sys, 0x3F01, 0x01); writePPU(sys, 0x3F02, 0x02); writePPU(sys, 0x3F03, 0x03)
    for (let row = 0; row < 30; row++) for (let col = 0; col < 32; col++) writePPU(sys, 0x2000 + row*32 + col, (col & 1) ? 2 : 1)
    sys.io.write(0x2001, 0x0A)

    // Run to the same scanline before enabling IRQ so timing is aligned
    runUntilScanline(sys, targetY)

    // Configure IRQ: latch=1; request reload; enable
    sys.bus.write(0xC000 as any, 1)
    sys.bus.write(0xC001 as any, 0)
    sys.bus.write(0xE001 as any, 0)

    // Run until end of this frame
    const curF = (sys.ppu as any).frame as number
    let steps2 = 0
    while (((sys.ppu as any).frame as number) === curF && steps2 < 60_000_000) { sys.stepInstruction(); steps2++ }
    if (steps2 >= 60_000_000) throw new Error('timeout finishing frame after enabling IRQ')

    const fb = (sys.ppu as any).getFrameBuffer() as Uint8Array

    // Check that the specific region around targetY shows gating: the targetY and next line match baseline, a later line differs
    const rowT0Base = sampleRow(fbBase, targetY, 32)
    const rowT1Base = sampleRow(fbBase, targetY + 1, 32)
    const rowT2Base = sampleRow(fbBase, targetY + 2, 32)

    const rowT0 = sampleRow(fb, targetY, 32)
    const rowT1 = sampleRow(fb, targetY + 1, 32)
    const rowT2 = sampleRow(fb, targetY + 2, 32)

    expect(rowT0).toBe(rowT0Base)
    expect(rowT1).toBe(rowT1Base)
    expect(rowT2).not.toBe(rowT2Base)
  })
})

