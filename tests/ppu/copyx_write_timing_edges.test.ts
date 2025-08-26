import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

function writePPUSCROLL(ppu: PPU, x: number, y: number) {
  ppu.cpuWrite(0x2005, x & 0xFF);
  ppu.cpuWrite(0x2005, y & 0xFF);
}

describe('PPU copyX write timing edges (vt)', () => {
  it('write to $2005 before cycle 257 is copied to v at 257', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // Start with coarseX=0
    writePPUSCROLL(ppu, 0, 0);
    ppu.cpuWrite(0x2001, 0x00);

    // Advance to visible scanline 5
    ppu.tick(5 * 341);

    // Approach cycle 257
    ppu.tick(240);
    // Prepare t with coarseX=2 (x=16)
    writePPUSCROLL(ppu, 16, 0);

    // Enable rendering to allow copyX at 257
    ppu.cpuWrite(0x2001, 0x08);
    // Cross cycle 257 window
    ppu.tick(100);

    const v = (ppu as any).v as number;
    expect(v & 0x1F).toBe(2);
  });

  it('write to $2005 after cycle 257 does not affect current v', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // Initial t coarseX=0
    writePPUSCROLL(ppu, 0, 0);

    // Enable rendering now
    ppu.cpuWrite(0x2001, 0x08);

    // Visible scanline 6, go near 257
    ppu.tick(6 * 341);
    ppu.tick(260);

    // Now write $2005 (too late for copyX on this line)
    writePPUSCROLL(ppu, 24, 0); // coarseX=3

    // Finish line
    ppu.tick(341 - 260);

    const v = (ppu as any).v as number;
    expect(v & 0x1F).not.toBe(3); // should still be old value for this line
  });
});

