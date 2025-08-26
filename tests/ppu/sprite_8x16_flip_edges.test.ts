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
function connectChr(ppu: PPU, chr: Uint8Array) {
  ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });
}

// Sprite 8x16 flip edges: ensure sprite 0 hit respects left masks regardless of flips

describe('Sprite 8x16 flip edges around x=7/8', () => {
  it('no hit at x<8 with H/V flips; hit at x=8', () => {
    const ppu = new PPU(); ppu.reset(); ppu.setTimingMode('vt');
    ppu.cpuWrite(0x2000, 0x20); // 8x16

    const chr = new Uint8Array(0x2000);
    // Make tile 0(top) and 1(bottom) with leftmost pixel set and also rightmost pixel set (for H flip)
    for (let y = 0; y < 8; y++) { chr[(0<<4)+y] = 0x81; chr[(1<<4)+y] = 0x81; }
    connectChr(ppu, chr);

    // BG palette and tile at top-left
    writePPU(ppu, 0x3F00, 0x00); writePPU(ppu, 0x3F01, 0x01); writePPU(ppu, 0x3F02, 0x02); writePPU(ppu, 0x3F03, 0x03);
    writePPU(ppu, 0x2000 + 0, 1);

    // Case x=7, H+V flips, left masks disabled -> no hit
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 0xFF); // Y
    ppu.cpuWrite(0x2004, 0x00); // tile even
    ppu.cpuWrite(0x2004, 0xC0); // H|V flips
    ppu.cpuWrite(0x2004, 0x07); // X=7
    ppu.cpuWrite(0x2001, 0x18); // bg+spr on, left masks off
    writeAddr(ppu, 0x2000);
    ppu.tick(9);
    expect(((ppu as any).status & 0x40) !== 0).toBe(false);

    // Case x=8, H+V flips, left masks disabled -> hit
    ppu.reset(); ppu.setTimingMode('vt'); connectChr(ppu, chr);
    writePPU(ppu, 0x3F00, 0x00); writePPU(ppu, 0x3F01, 0x01); writePPU(ppu, 0x3F02, 0x02); writePPU(ppu, 0x3F03, 0x03);
    writePPU(ppu, 0x2000 + 0, 1);
    ppu.cpuWrite(0x2000, 0x20);
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 0xFF);
    ppu.cpuWrite(0x2004, 0x00);
    ppu.cpuWrite(0x2004, 0xC0);
    ppu.cpuWrite(0x2004, 0x08);
    ppu.cpuWrite(0x2001, 0x18);
    writeAddr(ppu, 0x2000);
    ppu.tick(341);
    expect(((ppu as any).status & 0x40) !== 0).toBe(true);
  });
});

