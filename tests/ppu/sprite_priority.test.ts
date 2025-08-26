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

describe('PPU sprite/background priority', () => {
  it('respects sprite priority bit: front vs behind background when both non-zero', () => {
    const ppu = new PPU();
    ppu.reset();

    // CHR tiles: tile 1 => pix=1 (lo=0xFF), tile 2 => pix=2 (hi=0xFF)
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;      // lo plane -> pix bit0=1
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF;  // hi plane -> pix bit1=1
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palettes: BG palette 0: [0,1,2,3]; Sprite palette 0: [0,5,6,7] so we can distinguish
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);
    writePPU(ppu, 0x3F10, 0x00);
    writePPU(ppu, 0x3F11, 0x05);
    writePPU(ppu, 0x3F12, 0x06);
    writePPU(ppu, 0x3F13, 0x07);

    // Attribute tables zero -> BG palette 0
    for (let i = 0; i < 64; i++) writePPU(ppu, 0x23C0 + i, 0x00);

    // Place BG tile 1 at coarseX=2, coarseY=3 (pixels 16..23, 24..31) so bg pixel at (16,24) is non-zero (value 1)
    writePPU(ppu, 0x2000 + (3 * 32 + 2), 1);

    // Enable BG and sprites and left 8 pixels
    ppu.cpuWrite(0x2001, 0x1E);

    // Helper to set sprite 0
    function setSprite0(y: number, tile: number, attr: number, x: number) {
      ppu.cpuWrite(0x2003, 0x00);
      ppu.cpuWrite(0x2004, y & 0xFF);
      ppu.cpuWrite(0x2004, tile & 0xFF);
      ppu.cpuWrite(0x2004, attr & 0xFF);
      ppu.cpuWrite(0x2004, x & 0xFF);
    }

    // Case 1: priority front (attr bit5 = 0) -> sprite color should win when bg pixel is non-zero
    setSprite0(23, 1, 0x00 /* front */, 16);
    const fb1 = (ppu as any).renderFrame() as Uint8Array;
    const colorFront = fb1[24 * 256 + 16] & 0x3F;
    // Sprite 0 palette 0, pix=1 => 0x3F10 + 1 => color 5
    expect(colorFront).toBe(5);

    // Case 2: priority behind (attr bit5 = 1) -> background color should show when bg pixel is non-zero
    setSprite0(23, 1, 0x20 /* behind */, 16);
    const fb2 = (ppu as any).renderFrame() as Uint8Array;
    const colorBehind = fb2[24 * 256 + 16] & 0x3F;
    // Background palette 0, pix=1 => 1
    expect(colorBehind).toBe(1);

    // Case 3: background transparent (tile 0 at location), priority behind => sprite should be visible
    // Clear BG tile at (2,3) to 0 (bg pix=0)
    writePPU(ppu, 0x2000 + (3 * 32 + 2), 0);
    setSprite0(23, 1, 0x20 /* behind */, 16);
    const fb3 = (ppu as any).renderFrame() as Uint8Array;
    const colorBehindOnBg0 = fb3[24 * 256 + 16] & 0x3F;
    expect(colorBehindOnBg0).toBe(5);
  });
});

