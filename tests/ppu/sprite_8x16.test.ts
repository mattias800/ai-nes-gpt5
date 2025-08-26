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

function connectChrRam(ppu: PPU, chr: Uint8Array) {
  ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });
}

describe('PPU 8x16 sprite sampling', () => {
  it('renders 8x16 sprite across both tiles (table 0, no flip)', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // Enable sprites only, show left 8
    ppu.cpuWrite(0x2001, 0x14); // 0001 0100 -> spr left on + sprites on

    // Enable 8x16 sprites
    ppu.cpuWrite(0x2000, 0x20);

    // CHR RAM: table 0 (0x0000). Tile 0 (top) and 1 (bottom) have a solid leftmost pixel (bit7)
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) { chr[(0 << 4) + y] = 0x80; chr[(1 << 4) + y] = 0x80; }
    connectChrRam(ppu, chr);
    // Sprite palette: set palette 0 entries non-zero so framebuffer shows non-zero
    writePPU(ppu, 0x3F10, 0x00);
    writePPU(ppu, 0x3F11, 0x01);
    writePPU(ppu, 0x3F12, 0x02);
    writePPU(ppu, 0x3F13, 0x03);

    // Sprite 0: y=0 (OAM Y=255), x=0, tile=0 (even -> table 0), attr=0
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 0xFF); // Y
    ppu.cpuWrite(0x2004, 0x00); // tile
    ppu.cpuWrite(0x2004, 0x00); // attr
    ppu.cpuWrite(0x2004, 0x00); // X

    // Render first 10 visible lines to cover y=0 and y=9
    ppu.tick(341 * 10);

    const fb = (ppu as any).getFrameBuffer() as Uint8Array;
    const w = 256;
    // Check pixel at (0,0) non-zero (top tile)
    expect(fb[0] & 0x3F).not.toBe(0);
    // Check pixel at (0,9) non-zero (bottom tile)
    expect(fb[9 * w + 0] & 0x3F).not.toBe(0);
  });

  it('renders 8x16 sprite using table 1 when tile LSB=1, with vertical flip', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');
    ppu.cpuWrite(0x2001, 0x14); // sprites only + left 8
    ppu.cpuWrite(0x2000, 0x20); // 8x16

    // CHR RAM: table 1 (0x1000). For 8x16 with tile=1, topTile = 0 and bottom = 1 in table 1
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) { chr[0x1000 + (0 << 4) + y] = 0x80; chr[0x1000 + (1 << 4) + y] = 0x80; }
    connectChrRam(ppu, chr);
    // Sprite palette for palette 0
    writePPU(ppu, 0x3F10, 0x00);
    writePPU(ppu, 0x3F11, 0x01);
    writePPU(ppu, 0x3F12, 0x02);
    writePPU(ppu, 0x3F13, 0x03);

    // Sprite 0: y=0, x=0, tile=1 (odd -> table 1), attr VFLIP
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 0xFF); // Y
    ppu.cpuWrite(0x2004, 0x01); // tile=1 -> table 1
    ppu.cpuWrite(0x2004, 0x80); // attr V flip
    ppu.cpuWrite(0x2004, 0x00); // X

    ppu.tick(341 * 10);
    const fb = (ppu as any).getFrameBuffer() as Uint8Array;
    const w = 256;
    // With V flip, still expect visible pixels at top and bottom positions
    expect(fb[0] & 0x3F).not.toBe(0);
    expect(fb[9 * w + 0] & 0x3F).not.toBe(0);
  });
});

