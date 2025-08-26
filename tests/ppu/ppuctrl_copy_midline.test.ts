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

describe('PPU $2000 nametable base change mid-scanline (vt timing)', () => {
  it('before copyX (cycle 257) does not affect the same scanline; effect begins next scanline', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // CHR: tile1 pix=1, tile2 pix=2
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;       // tile 1 low
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF;  // tile 2 high
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palette identity
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // NT0 all tile 1, NT1 all tile 2
    for (let i = 0; i < 960; i++) writePPU(ppu, 0x2000 + i, 1);
    for (let i = 0; i < 960; i++) writePPU(ppu, 0x2400 + i, 2);

    // Start with $2000 nametable base 0 (NT0)
    ppu.cpuWrite(0x2000, 0x00);
    ppu.cpuWrite(0x2001, 0x0A);
    ppu.cpuWrite(0x2005, 0); // X
    ppu.cpuWrite(0x2005, 0); // Y

    // Advance to scanline 40
    for (let sl = 0; sl < 40; sl++) ppu.tick(341);

    // Render full row 40
    for (let c = 0; c < 256; c++) ppu.tick(1);
    const fb40 = (ppu as any).getFrameBuffer() as Uint8Array;
    const row40 = Array.from({ length: 16 }, (_, i) => fb40[40 * 256 + i] & 0x3F).join(',');

    // Begin scanline 41, write $2000 to switch to NT1 at cycle 100 (before copyX)
    ppu.tick(100);
    ppu.cpuWrite(0x2000, 0x01);
    ppu.tick(341 - 100);

    const fb41 = (ppu as any).getFrameBuffer() as Uint8Array;
    const row41 = Array.from({ length: 16 }, (_, i) => fb41[41 * 256 + i] & 0x3F).join(',');
    // No effect within the same scanline under vt timing
    expect(row41).toBe(row40);

    // Next scanline 42 should reflect base switch
    const fb42 = (ppu as any).getFrameBuffer() as Uint8Array;
    const row42 = Array.from({ length: 16 }, (_, i) => fb42[42 * 256 + i] & 0x3F).join(',');
    expect(row42).not.toBe(row40);
  });
});

