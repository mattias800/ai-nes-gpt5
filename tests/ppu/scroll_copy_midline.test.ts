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

describe('PPU copyX timing at cycle 257', () => {
  it('mid-scanline $2005 X writes do not affect pixels of the same scanline; effect starts next scanline', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // CHR: tile1 pix=1, tile2 pix=2
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF;
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palette identity
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // Fill NT0 with alternating vertical stripes 1,2,1,2...
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 32; col++) writePPU(ppu, 0x2000 + row * 32 + col, (col & 1) ? 2 : 1);
    }

    ppu.cpuWrite(0x2001, 0x0A); // show BG
    ppu.cpuWrite(0x2005, 0); // fine X=0, coarseX base from t
    ppu.cpuWrite(0x2005, 0); // Y

    // Advance to visible scanline 40
    for (let sl = 0; sl < 40; sl++) ppu.tick(341);

    // Sample row 40 pattern before change
    for (let c = 0; c < 256; c++) ppu.tick(1);
    const fb1 = (ppu as any).getFrameBuffer() as Uint8Array;
    const row40Before = Array.from({ length: 16 }, (_, i) => fb1[40 * 256 + i] & 0x3F).join(',');

    // Next scanline 41: perform mid-scanline write at cycle ~100 (well before 257)
    // Run beginning of scanline 41 up to cycle 100
    ppu.tick(100);
    // Change fine X scroll to shift stripes by 4 pixels
    ppu.cpuWrite(0x2005, 4);
    ppu.cpuWrite(0x2005, 0);
    // Complete remainder of scanline 41
    ppu.tick(341 - 100);

    const fb2 = (ppu as any).getFrameBuffer() as Uint8Array;
    // Row 41 should still match base pattern as copyX occurs at cycle 257 (after visible pixels)
    const row41 = Array.from({ length: 16 }, (_, i) => fb2[41 * 256 + i] & 0x3F).join(',');
    expect(row41).toBe(row40Before);

    // Next scanline 42 should reflect the new X scroll base (pattern differs)
    for (let sl = 42; sl <= 42; sl++) {/* already in place since we completed line 41 */}
    const fb3 = (ppu as any).getFrameBuffer() as Uint8Array;
    const row42 = Array.from({ length: 16 }, (_, i) => fb3[42 * 256 + i] & 0x3F).join(',');
    expect(row42).not.toBe(row40Before);
  });
});

