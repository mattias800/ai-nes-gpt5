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

describe('PPU split scrolling Y mid-frame', () => {
  it('Y scroll change applies next frame (copyY) under vt timing', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // CHR with three tiles: tile 1 => pix=1, tile 2 => pix=2, tile 3 => pix=3
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;       // tile 1 low
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF;  // tile 2 high
    for (let y = 0; y < 8; y++) { chr[(3 << 4) + y] = 0xFF; chr[(3 << 4) + 8 + y] = 0xFF; } // tile 3 both -> pix=3
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palette identity for 1..3
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // Clear attribute table (palette 0 everywhere)
    for (let i = 0; i < 64; i++) writePPU(ppu, 0x23C0 + i, 0x00);

    // Fill NT0 with horizontal stripes: rows alternate tile 1,2,3 pattern every 1 tile (8 px)
    for (let row = 0; row < 30; row++) {
      const tile = (row % 3) + 1; // 1,2,3 repeating each row
      for (let col = 0; col < 32; col++) writePPU(ppu, 0x2000 + row * 32 + col, tile);
    }

    // Enable BG and show left 8
    ppu.cpuWrite(0x2001, 0x0A);
    // Initial scroll X=0, Y=0
    ppu.cpuWrite(0x2005, 0);
    ppu.cpuWrite(0x2005, 0);

    // Run until mid-frame
    ppu.tick(120 * 341);

    // Increase Y scroll by 16 (two tiles) mid-frame
    ppu.cpuWrite(0x2005, 0);   // X unchanged
    ppu.cpuWrite(0x2005, 16);  // Y += 16

    // Finish frame
    ppu.tick((240 - 120) * 341);
    ppu.tick((262 - 240) * 341);

    const fb = (ppu as any).getFrameBuffer() as Uint8Array;

    // In vt mode, Y changes take effect next frame (after copyY). Same-frame top and bottom match.
    const x = 20;
    const sampleTop = [0, 8, 16, 24].map((dy) => fb[(40 + dy) * 256 + x] & 0x3F).join(',');
    const sampleBot = [0, 8, 16, 24].map((dy) => fb[(160 + dy) * 256 + x] & 0x3F).join(',');

    expect(sampleBot).toBe(sampleTop);

    // Next frame differs
    ppu.tick(262 * 341);
    const fb2 = (ppu as any).getFrameBuffer() as Uint8Array;
    const nextTop = [0, 8, 16, 24].map((dy) => fb2[(40 + dy) * 256 + x] & 0x3F).join(',');
    expect(nextTop).not.toBe(sampleTop);
  });
});

