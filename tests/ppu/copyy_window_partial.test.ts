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

// Verify that enabling rendering for a subset of the pre-render copyY window (e.g., 300..304)
// still performs copyY.
describe('PPU copyY partial window (vt)', () => {
  it('enabling rendering only for 300..304 still performs copyY', () => {
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

    // Fill NT0 with repeating rows: 1,2,3,...
    for (let row = 0; row < 30; row++) {
      const tile = (row % 3) + 1;
      for (let col = 0; col < 32; col++) writePPU(ppu, 0x2000 + row * 32 + col, tile);
    }

    // Set t Y to row2
    ppu.cpuWrite(0x2005, 0);
    ppu.cpuWrite(0x2005, (2 << 3));

    // Rendering disabled up to pre-render
    ppu.cpuWrite(0x2001, 0x00);

    // Advance to start of pre-render
    ppu.tick(261 * 341);

    // Advance to cycle 300
    ppu.tick(300);
    // Enable rendering for cycles 300..304
    ppu.cpuWrite(0x2001, 0x0A);
    ppu.tick(5);
    // Disable rendering again
    ppu.cpuWrite(0x2001, 0x00);

    // Finish pre-render
    ppu.tick(341 - 305);

    // Enable rendering for next visible line, show left 8
    ppu.cpuWrite(0x2001, 0x0A);
    ppu.tick(341);

    const fb = (ppu as any).getFrameBuffer() as Uint8Array;
    const colorTop = fb[0 * 256 + 0] & 0x3F;
    expect(colorTop).toBe(3);
  });
});

