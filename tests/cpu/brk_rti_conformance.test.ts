import { describe, it, expect } from 'vitest'
import { parseINes } from '@core/cart/ines'
import { NESSystem } from '@core/system/system'

function makeNrom16kBrkRtiRom(): Uint8Array {
  const PRG_SIZE = 16 * 1024
  const CHR_SIZE = 8 * 1024
  const total = 16 + PRG_SIZE + CHR_SIZE
  const rom = new Uint8Array(total)
  // iNES header
  rom[0] = 0x4E; rom[1] = 0x45; rom[2] = 0x53; rom[3] = 0x1A // NES<EOF>
  rom[4] = 0x01 // 1x16KB PRG
  rom[5] = 0x01 // 1x8KB CHR
  rom[6] = 0x00 // Mapper 0
  rom[7] = 0x00
  // PRG area fills with NOP (EA)
  const prgOff = 16
  rom.fill(0xEA, prgOff, prgOff + PRG_SIZE)
  const w = (addr: number, ...bytes: number[]) => {
    // For NROM-128, $C000 maps to start of PRG (mirror of $8000)
    const off = prgOff + ((addr - 0x8000) & 0x3FFF)
    for (let i = 0; i < bytes.length; i++) rom[off + i] = (bytes[i] & 0xFF)
  }
  // Program at $C000: LDX #$AB; TXS; CLC; BRK; (next at C006)
  w(0xC000, 0xA2, 0xAB) // LDX #$AB
  w(0xC002, 0x9A)       // TXS
  w(0xC003, 0x18)       // CLC (just to mutate flags)
  w(0xC004, 0x00)       // BRK
  // IRQ/BRK vector to $C100; place RTI there
  w(0xC100, 0x40)       // RTI
  // Vectors (use mirrors in last 6 bytes of PRG)
  const vecOff = prgOff + PRG_SIZE - 6
  // NMI
  rom[vecOff + 0] = 0x00; rom[vecOff + 1] = 0xC0 // $C000
  // Reset
  rom[vecOff + 2] = 0x00; rom[vecOff + 3] = 0xC0 // $C000
  // IRQ/BRK
  rom[vecOff + 4] = 0x00; rom[vecOff + 5] = 0xC1 // $C100
  // CHR can be zeros
  return rom
}

describe('CPU BRK/RTI conformance', () => {
  it('BRK pushes PC+2 and P|B|U; RTI restores P (B cleared) and PC', () => {
    const rom = makeNrom16kBrkRtiRom()
    const cart = parseINes(rom)
    const sys = new NESSystem(cart)
    sys.reset()
    const cpu: any = (sys as any).cpu

    // Step: LDX, TXS, CLC, BRK, RTI
    sys.stepInstruction() // LDX #$AB
    sys.stepInstruction() // TXS
    sys.stepInstruction() // CLC
    sys.stepInstruction() // BRK => jumps to IRQ vector $C100
    sys.stepInstruction() // RTI => returns to C006

    expect(cpu.state.pc & 0xFFFF).toBe(0xC006)
    expect(cpu.state.s & 0xFF).toBe(0xAB)
    // P restored; B cleared; U set; other bits same as power-on 0x24 after CLC
    expect((cpu.state.p & 0x10) === 0).toBe(true) // B cleared
    expect((cpu.state.p & 0x20) !== 0).toBe(true) // U set
  })
})
