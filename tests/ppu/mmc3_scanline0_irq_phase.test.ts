import { describe, it, expect } from 'vitest'
import { NESSystem } from '@core/system/system'

function writePPU(sys: NESSystem, addr: number, val: number) {
  sys.io.write(0x2006, (addr >> 8) & 0xFF)
  sys.io.write(0x2006, addr & 0xFF)
  sys.io.write(0x2007, val & 0xFF)
}

function buildIdlePrg(): Uint8Array {
  const prg = new Uint8Array(0x8000)
  // Reset at $8000: CLI; NOP; JMP $8003
  prg[0x0000] = 0x58
  prg[0x0001] = 0xEA
  prg[0x0002] = 0xEA
  prg[0x0003] = 0x4C; prg[0x0004] = 0x03; prg[0x0005] = 0x80
  // IRQ at $8100: RTI
  prg[0x0100] = 0x40
  // Vectors
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x81
  return prg
}

function runUntilFirstIRQ(sys: NESSystem, hardCap=120_000_000) {
  let steps = 0
  const mapper: any = (sys.cart as any).mapper
  while (steps < hardCap) {
    sys.stepInstruction()
    if (mapper.getTrace) {
      const tr: any[] = mapper.getTrace()
      const idx = tr.findIndex((e: any) => e.type === 'IRQ')
      if (idx >= 0) return tr[idx]
    }
    steps++
  }
  throw new Error('timeout waiting for IRQ')
}

describe('MMC3 scanline 0 IRQ phase comparison (VT)', () => {
  it('first IRQ occurs earlier with $2000=$08 (sprites@$1000) than with $2000=$10 (bg@$1000)', () => {
    const prg = buildIdlePrg()
    const chr = new Uint8Array(0x2000)
    const rom: any = { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0x00 }

    // Case A: $2000=$08 (sprites at $1000)
    const sysA = new NESSystem(rom)
    sysA.reset(); (sysA.ppu as any).setTimingMode?.('vt')
    // Enable BG+Sprites rendering
    sysA.io.write(0x2001, 0x18)
    // Choose sprites@$1000
    sysA.io.write(0x2000, 0x08)
    // Configure IRQ latch=0 (immediate on counted edge), reload pending, enable
    sysA.bus.write(0xC000 as any, 0)
    sysA.bus.write(0xC001 as any, 0)
    sysA.bus.write(0xE001 as any, 0)
    const irqA = runUntilFirstIRQ(sysA)

    // Case B: $2000=$10 (bg at $1000)
    const sysB = new NESSystem(rom)
    sysB.reset(); (sysB.ppu as any).setTimingMode?.('vt')
    sysB.io.write(0x2001, 0x18)
    sysB.io.write(0x2000, 0x10)
    sysB.bus.write(0xC000 as any, 0)
    sysB.bus.write(0xC001 as any, 0)
    sysB.bus.write(0xE001 as any, 0)
    const irqB = runUntilFirstIRQ(sysB)

    // Expect same frame delta vs pre-render, but within line 0, A at c260, B at c324 (A earlier)
    expect(irqA.f === irqB.f || irqA.f + 1 === irqB.f).toBe(true)
    expect(irqA.s).toBe(0)
    expect(irqB.s).toBe(0)
    expect(irqA.c).toBeLessThan(irqB.c)
    // Heuristic: typical cycles ~260 vs ~324
    expect(irqA.c).toBeGreaterThan(200)
    expect(irqB.c).toBeGreaterThan(300)
  })
})

