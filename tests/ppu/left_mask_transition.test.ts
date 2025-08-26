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

// Verify left-edge background mask transition at x=7 -> x=8
// With bg-left disabled (PPUMASK bit1=0), background is hidden for x<8 and visible at x>=8.
describe('PPU left-edge background mask transition (x=7 -> x=8)', () => {
  it('bg-left disabled hides x<8 and shows x>=8', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // CHR: tile 1 => pix=1 (lo)
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palette identity
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // BG tile 1 at top-left and next to it, so x=8 samples tile with color 1
    writePPU(ppu, 0x2000 + 0, 1);
    writePPU(ppu, 0x2000 + 1, 1);

    // Disable bg-left (bit1=0), enable bg (bit3=1)
    ppu.cpuWrite(0x2001, 0x08);

    // Ensure v/t scroll base is zeroed so vt sampling isn't affected by prior VRAM writes
    writeAddr(ppu, 0x0000);

    // Render an offline frame to sample left-edge behavior deterministically
    const fb = (ppu as any).renderFrame() as Uint8Array;

    // x=7 within left 8 -> masked to backdrop (color 0)
    const c7 = fb[0 * 256 + 7] & 0x3F;
    // x=8 shows background (color 1)
    const c8 = fb[0 * 256 + 8] & 0x3F;

    // Sanity-check vt sampler
    const pix8 = (ppu as any).sampleBgPixelV(8, 0) & 0x03;
    const col8 = (ppu as any).sampleBgColorV(8, 0) & 0x3F;
    expect(pix8).toBeGreaterThan(0);
    expect(col8).toBe(1);

    expect(c7).toBe(0);
    expect(c8).toBe(1);
  });
});

