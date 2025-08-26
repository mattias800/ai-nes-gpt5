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

// Build a minimal 32KB PRG image with a reset loop and an IRQ handler that writes $2000
function buildPrg(): Uint8Array {
  const prg = new Uint8Array(0x8000) // 32KB
  // Reset at $8000: CLI; NOP; JMP $8003
  prg[0x0000] = 0x58 // CLI
  prg[0x0001] = 0xEA // NOP
  prg[0x0002] = 0xEA // NOP
  prg[0x0003] = 0x4C // JMP abs
  prg[0x0004] = 0x03 // low
  prg[0x0005] = 0x80 // high
  // IRQ handler at $8100: PHA; LDA #$01; STA $2000; PLA; RTI
  const irq = 0x0100
  prg[irq + 0x0000] = 0x48 // PHA
  prg[irq + 0x0001] = 0xA9 // LDA #imm
  prg[irq + 0x0002] = 0x01 // #$01 -> base NT X = 1
  prg[irq + 0x0003] = 0x8D // STA abs
  prg[irq + 0x0004] = 0x00 // low
  prg[irq + 0x0005] = 0x20 // high -> $2000
  prg[irq + 0x0006] = 0x68 // PLA
  prg[irq + 0x0007] = 0x40 // RTI
  // Vectors at $FFFC/$FFFD (reset) and $FFFE/$FFFF (IRQ)
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80 // reset -> $8000
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x81 // IRQ -> $8100
  return prg
}

// VT-mode raster split integration: MMC3 IRQ triggers and sets base NT to $2400 mid-frame; verify framebuffer top/bottom differ

describe('MMC3 raster split: IRQ-driven base nametable change (VT)', () => {
  it('after IRQ, subsequent lines use new base nametable', () => {
    const prg = buildPrg()
    const chr = new Uint8Array(0x2000)
    // Tile #1 -> pix=1 (lo plane = 0xFF)
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF
    // Tile #2 -> pix=2 (hi plane = 0xFF)
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF
    const rom: any = { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0x00 }

    const sys = new NESSystem(rom)
    sys.reset()
    ;(sys.ppu as any).setTimingMode?.('vt')

    // Palette: BG palette 0: [0, 0x05, 0x06, 0x07]
    writePPU(sys, 0x3F00, 0x00)
    writePPU(sys, 0x3F01, 0x05) // color for pix1
    writePPU(sys, 0x3F02, 0x06) // color for pix2
    writePPU(sys, 0x3F03, 0x07)

    // Fill first column of NT $2000 with tile #1 across all rows
    for (let row = 0; row < 30; row++) {
      writePPU(sys, 0x2000 + row * 32 + 0, 1)
    }
    // Fill first column of NT $2400 with tile #2 across all rows
    for (let row = 0; row < 30; row++) {
      writePPU(sys, 0x2400 + row * 32 + 0, 2)
    }

    // Enable BG+SPR with left masks visible
    sys.io.write(0x2001, 0x1E)
    // Ensure base nametable starts at $2000
    sys.io.write(0x2000, 0x00)

    // Configure MMC3 IRQ: latch=1, request reload, enable
    sys.bus.write(0xC000 as any, 1)
    sys.bus.write(0xC001 as any, 0)
    sys.bus.write(0xE001 as any, 0)

    // Run CPU until we reach VBlank of the first rendered frame, so we capture that frame's buffer
    let steps = 0
    const hardCap = 30_000_000
    while ((sys.ppu.scanline as any) < 241 && steps < hardCap) { sys.stepInstruction(); steps++ }
    if (steps >= hardCap) throw new Error('Timed out waiting for VBlank in first frame')

    const fb = (sys.ppu as any).getFrameBuffer() as Uint8Array
    // Sample top-left pixel (before IRQ effect): should be color for tile #1 -> 0x05
    const topColor = fb[0] & 0x3F
    // Sample further down (after IRQ effect has applied to subsequent lines): pick y=40 for safety
    const w = 256
    const bottomColor = fb[40 * w + 0] & 0x3F

    // Early top line may be universal color on first frame depending on reset timing; accept 0x05 or 0x00
    expect([0x05, 0x00]).toContain(topColor)
    expect(bottomColor).toBe(0x06)
  })
})

