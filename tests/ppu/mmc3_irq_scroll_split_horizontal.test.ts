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

// PRG with IRQ handler that performs $2005 fineX change: LDA #$04; STA $2005; LDA #$00; STA $2005
function buildPrgScrollIRQ(): Uint8Array {
  const prg = new Uint8Array(0x8000)
  // Reset: CLI; NOP; JMP $8003
  prg[0x0000] = 0x58
  prg[0x0001] = 0xEA
  prg[0x0002] = 0xEA
  prg[0x0003] = 0x4C; prg[0x0004] = 0x03; prg[0x0005] = 0x80
  // IRQ at $8100
  const irq = 0x0100
  prg[irq+0] = 0x48 // PHA
  prg[irq+1] = 0xA9; prg[irq+2] = 0x04 // LDA #$04
  prg[irq+3] = 0x8D; prg[irq+4] = 0x05; prg[irq+5] = 0x20 // STA $2005
  prg[irq+6] = 0xA9; prg[irq+7] = 0x00 // LDA #$00
  prg[irq+8] = 0x8D; prg[irq+9] = 0x05; prg[irq+10] = 0x20 // STA $2005
  prg[irq+11] = 0x68 // PLA
  prg[irq+12] = 0x40 // RTI
  // Vectors
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x81
  return prg
}

function makeStripeRom(): { prg: Uint8Array, chr: Uint8Array } {
  const prg = buildPrgScrollIRQ()
  const chr = new Uint8Array(0x2000)
  // tile #1: pix=1 (lo plane 0xFF)
  for (let y = 0; y < 8; y++) chr[(1<<4)+y] = 0xFF
  // tile #2: pix=2 (hi plane 0xFF)
  for (let y = 0; y < 8; y++) chr[(2<<4)+8+y] = 0xFF
  return { prg, chr }
}

function runToVBlank(sys: NESSystem, frames: number = 1, cap = 50_000_000) {
  const start = (sys.ppu as any).frame as number
  let steps = 0
  while (((sys.ppu as any).frame as number) < start + frames && steps < cap) { sys.stepInstruction(); steps++ }
  if (steps >= cap) throw new Error('timeout waiting for vblank')
}

function sampleRow(fb: Uint8Array, y: number, count: number): string {
  const w = 256
  let out: number[] = []
  for (let i = 0; i < count; i++) out.push(fb[y*w + i] & 0x3F)
  return out.join(',')
}

// Verify that enabling MMC3 IRQ and performing $2005 writes in the handler changes horizontal scroll on subsequent lines compared to baseline

describe('MMC3 raster: IRQ-driven horizontal scroll split via $2005 (VT)', () => {
  it('row pattern differs from baseline after IRQ scroll writes', () => {
    const { prg, chr } = makeStripeRom()

    // Baseline system without enabling IRQ
    const romBase: any = { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0x00 }
    const base = new NESSystem(romBase)
    base.reset(); (base.ppu as any).setTimingMode?.('vt')
    // Palette identity
    writePPU(base, 0x3F00, 0x00); writePPU(base, 0x3F01, 0x01); writePPU(base, 0x3F02, 0x02); writePPU(base, 0x3F03, 0x03)
    // Fill NT0 with vertical stripes 1,2,1,2...
    for (let row = 0; row < 30; row++) for (let col = 0; col < 32; col++) writePPU(base, 0x2000 + row*32 + col, (col & 1) ? 2 : 1)
    // Enable BG and show left 8
    base.io.write(0x2001, 0x0A)
    // Run to VBlank
    runToVBlank(base, 1)
    const fbBase = (base.ppu as any).getFrameBuffer() as Uint8Array
    const rowBase = sampleRow(fbBase, 60, 32)

    // System with IRQ enabled
    const romIRQ: any = { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0x00 }
    const sys = new NESSystem(romIRQ)
    sys.reset(); (sys.ppu as any).setTimingMode?.('vt')
    writePPU(sys, 0x3F00, 0x00); writePPU(sys, 0x3F01, 0x01); writePPU(sys, 0x3F02, 0x02); writePPU(sys, 0x3F03, 0x03)
    for (let row = 0; row < 30; row++) for (let col = 0; col < 32; col++) writePPU(sys, 0x2000 + row*32 + col, (col & 1) ? 2 : 1)
    sys.io.write(0x2001, 0x0A)

    // Configure MMC3 IRQ: latch=1, request reload, enable
    sys.bus.write(0xC000 as any, 1)
    sys.bus.write(0xC001 as any, 0)
    sys.bus.write(0xE001 as any, 0)

    runToVBlank(sys, 1)
    const fbIRQ = (sys.ppu as any).getFrameBuffer() as Uint8Array
    const rowIRQ = sampleRow(fbIRQ, 60, 32)

    expect(rowIRQ).not.toBe(rowBase)
  })
})

