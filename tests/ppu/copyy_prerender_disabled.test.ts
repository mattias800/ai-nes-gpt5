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

describe('PPU copyY gating when rendering disabled (vt)', () => {
  it('does not run copyY at pre-render if rendering is disabled; next frame top row remains unchanged', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // CHR tiles: 1->pix=1, 2->pix=2, 3->pix=3
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF;
    for (let y = 0; y < 8; y++) { chr[(3 << 4) + y] = 0xFF; chr[(3 << 4) + 8 + y] = 0xFF; }
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palette identity
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // Fill NT0 with repeating rows: 1,2,3,1,2,3...
    for (let row = 0; row < 30; row++) {
      const tile = (row % 3) + 1;
      for (let col = 0; col < 32; col++) writePPU(ppu, 0x2000 + row * 32 + col, tile);
    }

    // Leave rendering disabled during pre-render so copyY should not run
    ppu.cpuWrite(0x2001, 0x00);
    // Set t Y to point to row2 (tile 3) to detect if copyY would have taken effect
    ppu.cpuWrite(0x2005, 0); // X
    ppu.cpuWrite(0x2005, (2 << 3)); // coarseY=2, fineY=0

    // Run a full frame plus one scanline (pre-render passes with rendering disabled)
    ppu.tick(262 * 341 + 341);

    // Now enable background and show left 8 pixels so x=0 is visible
    ppu.cpuWrite(0x2001, 0x0A);

    // Reset v/t so vt sampling is not biased by previous VRAM writes
    writeAddr(ppu, 0x0000);

    const fb = (ppu as any).renderFrame() as Uint8Array;
    const colorTop = fb[0 * 256 + 0] & 0x3F;
    // Without copyY, row 0 should still be tile 1 -> color 1
    expect(colorTop).toBe(1);
  });
});

