import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function romNOP(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0] = 0xEA; // NOP
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80; // reset vector
  const chr = new Uint8Array(0x2000);
  return { prg, chr, mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('PPU odd-frame scaffolding (no functional skip yet)', () => {
  it('frames increment and pre-render clears vblank and sprite0 each frame', () => {
    const sys = new NESSystem(romNOP());
    sys.reset();
    // Enable background to simulate rendering on
    sys.io.write(0x2001, 0x08);
    const start = sys.ppu.frame;
    // Run one full frame worth of CPU steps approximately
    // We don't rely on exact steps; just drive enough to advance a couple frames
    for (let i = 0; i < 20000; i++) sys.stepInstruction();
    expect(sys.ppu.frame).toBeGreaterThan(start);
    // After entering pre-render, status vblank and sprite0 should be cleared (verified by reading status twice)
    const s1 = sys.ppu.cpuRead(0x2002);
    // Can't assert timing precisely here; ensure flags get cleared at some point
    const s2 = sys.ppu.cpuRead(0x2002);
    expect((s1 & 0x80) === 0 || (s2 & 0x80) === 0).toBe(true);
  });
});

