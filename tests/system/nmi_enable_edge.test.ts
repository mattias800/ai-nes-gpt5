import { describe, it, expect } from 'vitest';
import type { INesRom } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

function makeRom(): INesRom {
  const prg = new Uint8Array(0x8000);
  const chr = new Uint8Array(0x2000);
  // Reset=$8000
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  // NMI=$9000
  prg[0x7FFA] = 0x00; prg[0x7FFB] = 0x90;
  // Program: NOP; NOP (we'll enable NMI during VBlank via IO later)
  prg.set([0xEA, 0xEA], 0x0000);
  return { prg, chr, mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('NMI edge when enabling during VBlank', () => {
  it('fires NMI when $2000 bit7 is set while VBlank already active', () => {
    const rom = makeRom();
    const sys = new NESSystem(rom);
    sys.reset();

    // Ensure NMI disabled initially
    sys.io.write(0x2000, 0x00);

    // Advance PPU into VBlank
    sys.ppu.tick(241 * 341 + 1);
    expect((sys.ppu as any).status & 0x80).toBe(0x80);

    // Enabling NMI during VBlank should edge-trigger NMI
    sys.io.write(0x2000, 0x80);

    // Next instruction should service NMI
    sys.stepInstruction();
    expect(sys.cpu.state.pc).toBe(0x9000);
  });
});
