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

// Verify 8x16 sprite 0 hit edges similar to 8x8 tests

describe('PPU sprite 0 hit edges (8x16)', () => {
  it('no hit at x<8 when left masks disabled; hit at x=8', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // Enable 8x16
    ppu.cpuWrite(0x2000, 0x20);

    // CHR RAM: table 0, tiles 0(top) and 1(bottom) solid leftmost pixel
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) { chr[(0 << 4) + y] = 0xFF; chr[(1 << 4) + y] = 0xFF; }
    connectChrRam(ppu, chr);

    // BG palette and tile so background is non-zero at top-left
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);
    writePPU(ppu, 0x2000 + 0, 1);

    // Sprite 0 at x=7 -> should not count when left masks disabled
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 0xFF); // Y -> 0
    ppu.cpuWrite(0x2004, 0x00); // tile even -> table 0
    ppu.cpuWrite(0x2004, 0x00); // attr
    ppu.cpuWrite(0x2004, 0x07); // X=7

    // Disable left masks (bg+spr visible but left bits off)
    ppu.cpuWrite(0x2001, 0x18);
    writeAddr(ppu, 0x2000);

    // Tick only x=0..7 region
    ppu.tick(9);
    expect(((ppu as any).status & 0x40) !== 0).toBe(false);

    // Move to x=8 and enable again
    ppu.reset(); ppu.setTimingMode('vt'); connectChrRam(ppu, chr);
    writePPU(ppu, 0x3F00, 0x00); writePPU(ppu, 0x3F01, 0x01); writePPU(ppu, 0x3F02, 0x02); writePPU(ppu, 0x3F03, 0x03);
    writePPU(ppu, 0x2000 + 0, 1);
    ppu.cpuWrite(0x2000, 0x20);
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 0xFF);
    ppu.cpuWrite(0x2004, 0x00);
    ppu.cpuWrite(0x2004, 0x00);
    ppu.cpuWrite(0x2004, 0x08);
    ppu.cpuWrite(0x2001, 0x18);
    writeAddr(ppu, 0x2000);
    ppu.tick(341);
    expect(((ppu as any).status & 0x40) !== 0).toBe(true);
  });

  it('hit occurs even with sprite priority behind bg', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // 8x16
    ppu.cpuWrite(0x2000, 0x20);

    // CHR RAM table 0, solid leftmost pixel
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) { chr[(0 << 4) + y] = 0xFF; chr[(1 << 4) + y] = 0xFF; }
    connectChrRam(ppu, chr);

    // BG tile at top-left
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x2000 + 0, 1);

    // Sprite 0 at x=16, priority behind (bit5)
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 0xFF);
    ppu.cpuWrite(0x2004, 0x00);
    ppu.cpuWrite(0x2004, 0x20);
    ppu.cpuWrite(0x2004, 0x10);

    ppu.cpuWrite(0x2001, 0x1E); // show left bg+spr
    writeAddr(ppu, 0x2000);
    ppu.tick(341);
    expect(((ppu as any).status & 0x40) !== 0).toBe(true);
  });
});

