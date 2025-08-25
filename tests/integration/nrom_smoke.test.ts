import { describe, it, expect } from 'vitest';
import { CPUBus } from '@core/bus/memory';
import { NesIO } from '@core/io/nesio';
import { PPU } from '@core/ppu/ppu';
import { CPU6502 } from '@core/cpu/cpu';

// This is a headless smoke test for NROM: we assemble a tiny program in ROM space
// that writes to PPU registers and RAM, then loops forever. It verifies deterministic
// CPU stepping and basic IO communication. No PPU rendering is used.

describe('integration: NROM headless smoke', () => {
  it('boots a tiny program from $8000 and loops', () => {
    const bus = new CPUBus();
    const ppu = new PPU();
    const io = new NesIO(ppu, bus);
    bus.connectIO(io.read, io.write);

    // Program bytes at $8000
    const prg = new Uint8Array(0x8000);
    let i = 0;
    // LDA #$3F ; STA $2006 ; LDA #$00 ; STA $2006 ; LDA #$0F ; STA $2007
    const program = [0xA9, 0x3F, 0x8D, 0x06, 0x20, 0xA9, 0x00, 0x8D, 0x06, 0x20, 0xA9, 0x0F, 0x8D, 0x07, 0x20,
    // JMP $8000
    0x4C, 0x00, 0x80];
    prg.set(program, 0);

    bus.connectCart((addr) => {
      if (addr >= 0x8000) return prg[(addr - 0x8000) & 0x7FFF];
      return 0x00;
    }, (_addr, _v) => {});

    const cpu = new CPU6502(bus);
    cpu.reset(0x8000);

    // Step some instructions
    for (let k = 0; k < 16; k++) {
      cpu.step();
    }

    // Expect palette entry 0x00 to be 0x0F (grayscale white) due to writes
    // Note: palette mirroring makes indexes like 0x10 map to 0x00
    expect(ppu['palette'][0] & 0x3F).toBe(0x0F);
  });
});
