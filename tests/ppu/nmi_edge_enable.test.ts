import { describe, it, expect } from 'vitest';
import type { INesRom } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

function romNOP(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0] = 0xEA; // NOP
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80; // reset vector
  // NMI vector -> $9000
  prg[0x7FFA] = 0x00; prg[0x7FFB] = 0x90;
  const chr = new Uint8Array(0x2000);
  // Place a NOP at $9000 so post-NMI step increments PC predictably
  prg[0x1000] = 0xEA;
  return { prg, chr, mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('PPU NMI enable edge timing', () => {
  it('enabling NMI while already in VBlank triggers exactly one NMI service', () => {
    const sys = new NESSystem(romNOP());
    sys.reset();

    // Disable NMI and advance to VBlank
    sys.io.write(0x2000, 0x00);
    sys.ppu.tick(241 * 341 + 1);
    expect(((sys.ppu as any).status & 0x80) !== 0).toBe(true);

    // Enable NMI during VBlank -> edge-latched
    sys.io.write(0x2000, 0x80);

    // First step should service NMI
    sys.stepInstruction();
    expect(sys.cpu.state.pc).toBe(0x9000);

    const pcAfter = sys.cpu.state.pc;
    // Second step should not re-enter NMI immediately
    sys.stepInstruction();
    expect(sys.cpu.state.pc).toBe(pcAfter + 1);
  });
});

