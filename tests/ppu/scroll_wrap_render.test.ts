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

describe('PPU scroll wrap across nametables (background sampling)', () => {
  it('wraps horizontally from $2000 col 31 to $2400 col 0', () => {
    const ppu = new PPU();
    ppu.reset();

    // Connect CHR to a simple in-memory array so tiles render deterministic bits
    const chr = new Uint8Array(0x2000);
    // Tile 1: constant pixel value 1 (p1=0, p0=1)
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF; // lo
    // Tile 2: constant pixel value 2 (p1=1, p0=0)
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF; // hi
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // BG palette: universal=0, then colors 1..3 map equal to indices for easy asserts
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // Attribute tables zero => palette 0 across screen
    for (let i = 0; i < 64; i++) writePPU(ppu, 0x23C0 + i, 0x00); // NT0
    for (let i = 0; i < 64; i++) writePPU(ppu, 0x27C0 + i, 0x00); // NT1

    // Nametable 0 ($2000) set col 31 (coarseX=31) to tile 1 for all rows; NT1 ($2400) col 0 to tile 2
    for (let row = 0; row < 30; row++) {
      writePPU(ppu, 0x2000 + row * 32 + 31, 1);
      writePPU(ppu, 0x2400 + row * 32 + 0, 2);
    }

    // Set scroll: coarse X=31 (value=248), fine X=0; coarse Y=0, fine Y=0
    ppu.cpuWrite(0x2005, 248);
    ppu.cpuWrite(0x2005, 0);

    // Enable BG rendering and show left 8 pixels
    ppu.cpuWrite(0x2001, 0x0A);

    // Sample pixel at (x=0,y=0): should be from NT0 col31 tile1 -> color 1
    const fb = (ppu as any).renderBgFrame() as Uint8Array;
    const w = 256;
    const c0 = fb[0];
    expect(c0 & 0x3F).toBe(1);
    // Sample pixel at (x=8,y=0): should wrap to NT1 col0 tile2 -> color 2
    const c8 = fb[8];
    expect(c8 & 0x3F).toBe(2);
  });

  it('wraps vertically from $2000 row 31 to $2800 row 0', () => {
    const ppu = new PPU();
    ppu.reset();

    const chr = new Uint8Array(0x2000);
    // Tile 1 => pix=1, Tile 2 => pix=2
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF;
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    for (let i = 0; i < 64; i++) writePPU(ppu, 0x23C0 + i, 0x00);
    for (let i = 0; i < 64; i++) writePPU(ppu, 0x2BC0 + i, 0x00); // NT below $2000 is $2800

    // NT0 row 31 -> tile1; NT down ($2800) row 0 -> tile2 (use col 0)
    writePPU(ppu, 0x2000 + 31 * 32 + 0, 1);
    writePPU(ppu, 0x2800 + 0 * 32 + 0, 2);

    // Set scroll: coarse X=0 fineX=0; coarse Y=31 (value=248), fineY=0
    ppu.cpuWrite(0x2005, 0);
    ppu.cpuWrite(0x2005, 248);

    ppu.cpuWrite(0x2001, 0x0A);

    const fb = (ppu as any).renderBgFrame() as Uint8Array;
    const w = 256;
    // Pixel at (0,0) from NT0 row31 tile1 => color1
    expect(fb[0] & 0x3F).toBe(1);
    // Pixel at (0,8) wrapped to NT $2800 row0 tile2 => color2
    expect(fb[8 * w + 0] & 0x3F).toBe(2);
  });
});

