import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { INesRom } from '@core/cart/ines'
import { NESSystem } from '@core/system/system'

function makeRom(code: number[], pc = 0x8000): INesRom {
  const prg = new Uint8Array(0x8000).fill(0xEA) // default NOPs
  prg.set(code, 0x0000)
  // Reset vector -> $8000
  prg[0x7FFC] = pc & 0xFF
  prg[0x7FFD] = (pc >>> 8) & 0xFF
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8 * 1024, flags6: 0, flags7: 0 }
}

describe('APU DMC CPU stall (opt-in)', () => {
  const prev = { val: process.env.ENABLE_DMC_STALLS }
  beforeEach(() => { process.env.ENABLE_DMC_STALLS = '1' })
  afterEach(() => { process.env.ENABLE_DMC_STALLS = prev.val })

  it('adds ~4 CPU cycles to the current step when a DMC byte fetch occurs', () => {
    // Program: single NOP then infinite loop to keep stepping
    const code = [ 0xEA, 0x4C, 0x01, 0x80 ] // NOP; JMP $8001
    const sys = new NESSystem(makeRom(code))
    sys.reset()

    // Prepare PRG byte at a known DMC sample address (default base $C000)
    // Our NROM mapping mirrors PRG; ensure there is non-zero data at $C000.
    // The cartridge maps $8000..$FFFF to PRG[0..0x7FFF]; $C000 -> PRG[0x4000]
    sys.cart.rom.prg[0x4000] = 0x55

    // Configure DMC: enable IRQ disabled, loop off, choose a rate index; set length=1
    sys.io.write(0x4010, 0x00) // IRQ off, loop off, rate=0
    sys.io.write(0x4012, 0x00) // address base $C000 + 0
    sys.io.write(0x4013, 0x00) // length base -> 1 byte
    sys.io.write(0x4015, 0x10) // enable DMC (kicks off bytesRemaining if zero)

    // Force DMC to attempt a fetch on next APU bit engine step
    ;(sys.apu as any)['dmcBitsRemaining'] = 0
    ;(sys.apu as any)['dmcSampleBufferFilled'] = false
    ;(sys.apu as any)['dmcTimer'] = 0

    // Capture initial CPU/PPU cycles and step a single NOP (normally 2 cycles)
    const cpu0 = sys.cpu.state.cycles
    const ppu0 = sys.ppu.frame * 262 * 341 + sys.ppu.scanline * 341 + sys.ppu.cycle
    sys.stepInstruction() // executes NOP (2 cycles) and applies any DMC stall cycles
    const cpu1 = sys.cpu.state.cycles
    const ppu1 = sys.ppu.frame * 262 * 341 + sys.ppu.scanline * 341 + sys.ppu.cycle

    const cpuDelta = cpu1 - cpu0
    const ppuDelta = ppu1 - ppu0

    // Expect 2 (NOP) + 4 (stall) = 6 cycles exactly under this setup
    expect(cpuDelta).toBe(6)
    // System should keep PPU:CPU at 3:1 even across stall
    expect(ppuDelta).toBe(cpuDelta * 3)
  })
})

