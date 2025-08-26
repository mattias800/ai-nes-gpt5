import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

// Test that copyX copies both coarseX and the horizontal nametable bit from t into v

describe('PPU copyX copies ntX and coarseX (vt)', () => {
  it('copyX: v low bits match t low bits (0x041F mask)', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // Set t: ntX=1 via PPUCTRL, coarseX=3 via PPUSCROLL
    ppu.cpuWrite(0x2000, 0x01); // ntX=1
    ppu.cpuWrite(0x2005, 24);   // coarseX=3, fineX=0
    ppu.cpuWrite(0x2005, 0);    // y scroll (ignored)

    // Before copyX, ensure v differs
    (ppu as any).v = 0; // force distinct

    // Perform copyX directly
    (ppu as any).copyX();

    const v = (ppu as any).v as number;
    const t = (ppu as any).t as number;
    expect(v & 0x041F).toBe(t & 0x041F);
  });
});

