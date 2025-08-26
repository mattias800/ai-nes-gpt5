import { describe, it, expect } from 'vitest';
import type { INesRom } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

function makeRomNROM(prgSize = 0x8000): INesRom {
  const prg = new Uint8Array(prgSize);
  const chr = new Uint8Array(0x2000);
  return { prg, chr, mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('PPU NMI gating and status interactions', () => {
  it('late enabling NMI after vblank triggers immediate NMI on next CPU step', () => {
    const rom = makeRomNROM();
    // Reset vector -> $8000, NMI vector -> $9000
    rom.prg[0x7FFC] = 0x00; rom.prg[0x7FFD] = 0x80;
    rom.prg[0x7FFA] = 0x00; rom.prg[0x7FFB] = 0x90;
    // Program is irrelevant; we will drive IO directly and then step once

    rom.prg[0x0000] = 0xEA; // NOP at $8000 to ensure next step doesn't change PC unexpectedly
    const sys = new NESSystem(rom);
    sys.reset();

    // Ensure NMI disabled initially
    sys.io.write(0x2000, 0x00);

    // Advance PPU to vblank so nmiOccurred is set
    sys.ppu.tick(241 * 341 + 1);

    // Late-enable NMI output
    sys.io.write(0x2000, 0x80);

    // Next step should service NMI immediately
    sys.stepInstruction();
    expect(sys.cpu.state.pc).toBe(0x9000);
  });

  it('reading PPUSTATUS before enabling NMI cancels pending NMI edge', () => {
    const rom = makeRomNROM();
    rom.prg[0x7FFC] = 0x00; rom.prg[0x7FFD] = 0x80;
    rom.prg[0x7FFA] = 0x00; rom.prg[0x7FFB] = 0x90;
    rom.prg[0x0000] = 0xEA; // NOP at $8000 to keep PC stable across a step
    const sys = new NESSystem(rom);
    sys.reset();

    // Enter vblank with NMI disabled
    sys.io.write(0x2000, 0x00);
    sys.ppu.tick(241 * 341 + 1);

    // Read $2002 to clear vblank and nmiOccurred
    const st = sys.io.read(0x2002);
    expect((st & 0x80) !== 0).toBe(true); // it was set before clear
    const st2 = sys.io.read(0x2002);
    expect((st2 & 0x80) !== 0).toBe(false); // cleared

    // Now enable NMI output late
    sys.io.write(0x2000, 0x80);

    // Next step should NOT service NMI since edge was cleared
    const pcBefore = sys.cpu.state.pc;
    sys.stepInstruction();
    expect(sys.cpu.state.pc).not.toBe(0x9000);
    expect(sys.cpu.state.pc).toBe(((pcBefore + 1) & 0xFFFF));
  });
});

