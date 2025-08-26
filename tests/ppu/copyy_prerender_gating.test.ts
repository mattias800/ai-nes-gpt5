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

// Verify copyY occurs on pre-render (scanline 261, cycles 280..304) when rendering is enabled.
describe('PPU copyY pre-render window (vt)', () => {
  it('copyY affects top row of next frame when rendering enabled', () => {
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

    // Enable background and show left 8 pixels so x=0 is visible
    ppu.cpuWrite(0x2001, 0x0A);
    // Set t Y to point to row2 (tile 3) to detect copyY effect
    ppu.cpuWrite(0x2005, 0); // X
    ppu.cpuWrite(0x2005, (2 << 3)); // coarseY=2, fineY=0

    // Run one frame to reach pre-render and next visible, plus one line
    ppu.tick(262 * 341 + 341);
    const fb = (ppu as any).getFrameBuffer() as Uint8Array;
    const colorTop = fb[0 * 256 + 0] & 0x3F;
    expect(colorTop).toBe(3); // row0 now reflects t's Y (row2 -> color3)
  });
});

