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

function writeOAM(ppu: PPU, bytes: number[]) {
  ppu.cpuWrite(0x2003, 0x00);
  for (const b of bytes) ppu.cpuWrite(0x2004, b & 0xFF);
}

describe('PPU sprite 0 hit boundary and priority edges', () => {
  it('no sprite 0 hit at x<8 when left masks are disabled; hit occurs at x=8', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // CHR: background tile 1 -> color1, sprite tile 1 -> color1
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF; // lo plane -> 1
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palette identity (BG and SPR palettes)
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);
    writePPU(ppu, 0x3F10, 0x00);
    writePPU(ppu, 0x3F11, 0x01);
    writePPU(ppu, 0x3F12, 0x02);
    writePPU(ppu, 0x3F13, 0x03);

    // Background: tile 1 at top-left     // BG non-zero across first few tiles for x=16 as well
    writePPU(ppu, 0x2000 + 0, 1);
    writePPU(ppu, 0x2000 + 1, 1);
    writePPU(ppu, 0x2000 + 2, 1);

    // Case A: sprite 0 at x=7 (within left 8), y=0, tile 1, attr=0 (in front)
    writeOAM(ppu, [0xFF, 0x01, 0x00, 0x07]); // Y=255 -> sy=0, tile=1, attr=0, X=7

    // Reset VRAM address so VT sampling starts at top-left
    writeAddr(ppu, 0x2000);
    // Enable BG+SPR but left masks disabled (bit1=0, bit2=0)
    ppu.cpuWrite(0x2001, 0x18);

    // Render only up to x=7 (exclude x=8) to verify no hit occurs within left 8 pixels
    ppu.tick(9);
    expect(((ppu as any).status & 0x40) !== 0).toBe(false);

    // Case B: move sprite 0 to x=8 -> overlap at x>=8 should set hit
    ppu.reset();
    ppu.setTimingMode('vt');
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });
    writePPU(ppu, 0x3F00, 0x00); writePPU(ppu, 0x3F01, 0x01); writePPU(ppu, 0x3F02, 0x02); writePPU(ppu, 0x3F03, 0x03);
    writePPU(ppu, 0x3F10, 0x00); writePPU(ppu, 0x3F11, 0x01); writePPU(ppu, 0x3F12, 0x02); writePPU(ppu, 0x3F13, 0x03);
    writePPU(ppu, 0x2000 + 0, 1);
    writePPU(ppu, 0x2000 + 1, 1);
    writePPU(ppu, 0x2000 + 2, 1);
    writeOAM(ppu, [0xFF, 0x01, 0x00, 0x08]);
    // Reset VRAM address so VT sampling starts at top-left
    writeAddr(ppu, 0x2000);
    ppu.cpuWrite(0x2001, 0x18);
    ppu.tick(341);
    expect(((ppu as any).status & 0x40) !== 0).toBe(true);
  });

  it('sprite 0 hit occurs even if sprite priority is behind background (priority=1)', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF; // tile 1 -> color1
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);
    writePPU(ppu, 0x3F10, 0x00); writePPU(ppu, 0x3F11, 0x01);

    // Background: tile 1 across first row so x=16 overlaps non-zero bg
    writePPU(ppu, 0x2000 + 0, 1);
    writePPU(ppu, 0x2000 + 1, 1);
    writePPU(ppu, 0x2000 + 2, 1);

    // Sprite 0 at x=16, y=0, tile 1, attr priority=1 (bit5)
    writeOAM(ppu, [0xFF, 0x01, 0x20, 0x10]);

    // Reset VRAM address so VT sampling starts at top-left
    writeAddr(ppu, 0x2000);
    // Enable BG+SPR with left 8 visible (so x=0..7 also count)
    ppu.cpuWrite(0x2001, 0x1E); // bg+spr + show left bg+spr

    // Render first visible line
    ppu.tick(341);
    expect(((ppu as any).status & 0x40) !== 0).toBe(true);
  });
});

