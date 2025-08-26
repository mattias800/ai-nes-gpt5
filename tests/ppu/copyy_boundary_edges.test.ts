import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

// Validate copyY boundary behavior: enabling exactly at 280 and 304 copies; after 304 does not

describe('PPU copyY boundary edges (vt)', () => {
  it('enabling at exactly cycle 280 copies Y from t', () => {
    const ppu = new PPU(); ppu.reset(); ppu.setTimingMode('vt');
    // t: fineY=2, coarseY=5
    ppu.cpuWrite(0x2005, 0);
    ppu.cpuWrite(0x2005, (5 << 3) | 2);
    // prerender start
    ppu.tick(261 * 341);
    // at 280
    ppu.tick(280);
    // enable bg and advance one dot within window to execute copyY
    ppu.cpuWrite(0x2001, 0x08);
    ppu.tick(1);
    const v = (ppu as any).v as number; const t = (ppu as any).t as number;
    expect((v & 0x7BE0)).toBe(t & 0x7BE0);
  });

  it('enabling at exactly cycle 304 copies Y from t', () => {
    const ppu = new PPU(); ppu.reset(); ppu.setTimingMode('vt');
    ppu.cpuWrite(0x2005, 0); ppu.cpuWrite(0x2005, (10 << 3) | 6);
    ppu.tick(261 * 341); ppu.tick(304);
    ppu.cpuWrite(0x2001, 0x08);
    ppu.tick(1);
    const v = (ppu as any).v as number; const t = (ppu as any).t as number;
    expect((v & 0x7BE0)).toBe(t & 0x7BE0);
  });

  it('enabling at cycle 305 does NOT copy Y', () => {
    const ppu = new PPU(); ppu.reset(); ppu.setTimingMode('vt');
    ppu.cpuWrite(0x2005, 0); ppu.cpuWrite(0x2005, (3 << 3) | 7);
    ppu.tick(261 * 341); ppu.tick(305);
    ppu.cpuWrite(0x2001, 0x08);
    const v = (ppu as any).v as number; const t = (ppu as any).t as number;
    expect((v & 0x7BE0)).not.toBe(t & 0x7BE0);
  });
});

