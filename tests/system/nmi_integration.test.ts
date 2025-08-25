import { describe, it, expect } from 'vitest';
import type { INesRom } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

function makeRomNROM(prgSize = 0x8000): INesRom {
  const prg = new Uint8Array(prgSize);
  const chr = new Uint8Array(0x2000);
  return {
    prg, chr, mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0,
  };
}

describe('System NMI integration', () => {
  it('delivers NMI from PPU VBlank when enabled', () => {
    const rom = makeRomNROM();
    // Set reset vector to $8000
    rom.prg[0x7FFC] = 0x00; rom.prg[0x7FFD] = 0x80;
    // NMI vector to $9000
    rom.prg[0x7FFA] = 0x00; rom.prg[0x7FFB] = 0x90;
    // Program at $8000: enable NMI via write to $2000; then NOP
    // LDA #$80; STA $2000; NOP
    rom.prg.set([0xA9, 0x80, 0x8D, 0x00, 0x20, 0xEA], 0x0000);

    const sys = new NESSystem(rom);
    sys.reset();

    // Execute LDA, STA, NOP
    sys.stepInstruction();
    sys.stepInstruction();
    sys.stepInstruction();

    // Tick PPU into VBlank
    sys.ppu.tick(241 * 341 + 1);

    // Next instruction step should service NMI
    sys.stepInstruction();
    expect(sys.cpu.state.pc).toBe(0x9000);
  });
});
