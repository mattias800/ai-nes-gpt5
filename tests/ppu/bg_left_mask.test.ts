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

describe('PPU background left-edge mask', () => {
  it('hides background in left 8 pixels when bg-left is disabled', () => {
    const ppu = new PPU();
    ppu.reset();

    // CHR: tile 1 -> pix=1
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palette: universal=0, BG palette 0: [0,1,2,3]
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // Put non-zero BG tiles at the top-left two tiles (so x=8 also hits a non-zero tile)
    writePPU(ppu, 0x2000 + 0, 1);
    writePPU(ppu, 0x2000 + 1, 1);

    // Disable bg-left (bit1=0), enable sprites-left (doesn't matter here), bg on
    ppu.cpuWrite(0x2001, 0x08); // 0000 1000 -> bg on only, left masks disabled (bg-left=0)

    const fb = (ppu as any).renderBgFrame() as Uint8Array;

    // Left 8 pixels on row 0 should be universal background color (0)
    for (let x = 0; x < 8; x++) {
      expect(fb[0 * 256 + x] & 0x3F).toBe(0x00);
    }
    // Pixel at x=8 should reflect tile color (1)
    expect(fb[0 * 256 + 8] & 0x3F).toBe(0x01);
  });
});

