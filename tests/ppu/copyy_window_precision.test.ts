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

// Precisely gate rendering during pre-render cycles 280..304 to allow copyY, and verify
// the top row of the next frame reflects t's Y.
describe('PPU copyY precise window gating (vt)', () => {
  it('enabling rendering only during 280..304 performs copyY and updates next frame row0', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // CHR tiles: 1->pix=1, 2->pix=2, 3->pix=3
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF; // tile1 lo plane -> color1
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF; // tile2 hi plane -> color2
    for (let y = 0; y < 8; y++) { chr[(3 << 4) + y] = 0xFF; chr[(3 << 4) + 8 + y] = 0xFF; } // tile3 both -> color3
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

    // Set t Y to select row2 (tile 3) so copyY effect is visible
    ppu.cpuWrite(0x2005, 0); // X
    ppu.cpuWrite(0x2005, (2 << 3)); // coarseY=2, fineY=0

    // Keep rendering disabled up to pre-render
    ppu.cpuWrite(0x2001, 0x00);

    // Advance to start of pre-render line (scanline 261, cycle 0): 261 scanlines x 341 cycles
    ppu.tick(261 * 341);

    // Advance to cycle 280 of pre-render
    ppu.tick(280);

    // Enable rendering only for the copyY window; also show left 8 so x=0 is visible later
    ppu.cpuWrite(0x2001, 0x0A);
    // Remain enabled through cycle 304 inclusive
    ppu.tick(25); // cycles 280..304 -> 25 cycles

    // Disable rendering after copyY window
    ppu.cpuWrite(0x2001, 0x00);

    // Finish pre-render line
    ppu.tick(341 - 305);

    // Re-enable rendering for the next visible line to observe the effect
    ppu.cpuWrite(0x2001, 0x0A);

    // Render first visible line of the next frame
    ppu.tick(341);

    const fb = (ppu as any).getFrameBuffer() as Uint8Array;
    const colorTop = fb[0 * 256 + 0] & 0x3F;
    expect(colorTop).toBe(3);
  });
});

