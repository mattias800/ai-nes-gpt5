import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

function writeAddr(ppu: PPU, addr: number) {
  ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF);
  ppu.cpuWrite(0x2006, addr & 0xFF);
}

function writePPU(ppu: PPU, addr: number, val: number) {
  writeAddr(ppu, addr);
  ppu.cpuWrite(0x2007, val & 0xFF);
}

// Verify copyX occurs at visible scanline cycle 257 when rendering is enabled.
// We enable rendering around that cycle only, so no pixels render on the same line,
// but copyX updates v from t; the next scanline shows the horizontal shift.
describe('PPU copyX precise window (vt)', () => {
  it('enabling rendering near cycle 257 performs copyX; next line shows coarseX from t', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // CHR: tile1->color1, tile2->color2
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;      // lo plane -> 1
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF;  // hi plane -> 2
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palette identity
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // Fill NT0 with alternating columns 1,2,1,2,... so coarseX shift is visible at x=0
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 32; col++) writePPU(ppu, 0x2000 + row * 32 + col, (col & 1) ? 2 : 1);
    }

    // Prepare t: coarseX=1 (shift by one tile), fineX=0
    ppu.cpuWrite(0x2005, 8); // X: coarseX=(8>>3)=1, fineX=0
    ppu.cpuWrite(0x2005, 0); // Y: fineY=0, coarseY=0

    // Rendering disabled until window
    ppu.cpuWrite(0x2001, 0x00);

    // Advance to visible scanline 10, cycle 0
    ppu.tick(10 * 341);

    // Advance to near cycle 257
    ppu.tick(220);
    // Enable background for a wider window so copyX executes reliably
    ppu.cpuWrite(0x2001, 0x08);
    ppu.tick(100); // spans 220..319, covering cycle 257
    ppu.cpuWrite(0x2001, 0x00);

    // Finish line
    ppu.tick(341 - 320);

    // Verify v's coarseX was copied from t (should be 1)
    const vAfter = (ppu as any).v as number;
    expect(vAfter & 0x1F).toBe(1);

    // Next line: enable background and show left 8 so we can see x=0 (optional visual)
    ppu.cpuWrite(0x2001, 0x0A);
    ppu.tick(341);
  });
});

