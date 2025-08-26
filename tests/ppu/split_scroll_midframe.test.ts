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

describe('PPU split scrolling mid-frame effects', () => {
  it('applies fine X scroll changes mid-frame (vertical stripes shift below split)', () => {
    const ppu = new PPU();
    ppu.reset();

    // CHR with two tiles: tile 1 => pix=1 (lo plane = 0xFF), tile 2 => pix=2 (hi plane = 0xFF)
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;       // tile 1 low
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF;  // tile 2 high
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // BG palette: identity mapping for indices 1..3
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // Clear attribute table (palette 0 everywhere)
    for (let i = 0; i < 64; i++) writePPU(ppu, 0x23C0 + i, 0x00);

    // Fill NT0 ($2000) with alternating tiles per column -> vertical stripes
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 32; col++) {
        const tile = (col & 1) ? 2 : 1; // 1,2,1,2...
        writePPU(ppu, 0x2000 + row * 32 + col, tile);
      }
    }

    // Enable BG and show left 8 pixels
    ppu.cpuWrite(0x2001, 0x0A);
    // Initial scroll X=0, Y=0
    ppu.cpuWrite(0x2005, 0);
    ppu.cpuWrite(0x2005, 0);

    // Run until mid-frame (scanline ~120)
    ppu.tick(120 * 341);

    // Change fine X mid-frame by 4 pixels to shift stripes
    ppu.cpuWrite(0x2005, 4);
    ppu.cpuWrite(0x2005, 0);

    // Finish the rest of the visible scanlines and the frame
    ppu.tick((240 - 120) * 341);
    ppu.tick((262 - 240) * 341);

    const fb = (ppu as any).getFrameBuffer() as Uint8Array;

    // Sample a small horizontal window above and below the split
    const topY = 40; // above split
    const botY = 160; // below split
    const top: number[] = [];
    const bot: number[] = [];
    for (let x = 0; x < 16; x++) {
      top.push(fb[topY * 256 + x] & 0x3F);
      bot.push(fb[botY * 256 + x] & 0x3F);
    }

    // Expect the stripe pattern to differ due to fine X change
    expect(bot.join(',')).not.toBe(top.join(','));
  });

  it('switches base nametable mid-frame via $2000 (top from $2000, bottom from $2400) [vt mode]', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // CHR tiles as before
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;       // tile 1 -> pix=1
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF;  // tile 2 -> pix=2
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palette
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // Attributes cleared for both NT0 and NT1
    for (let i = 0; i < 64; i++) writePPU(ppu, 0x23C0 + i, 0x00);
    for (let i = 0; i < 64; i++) writePPU(ppu, 0x27C0 + i, 0x00);

    // NT0 ($2000) all tile 1, NT1 ($2400) all tile 2
    for (let i = 0; i < 960; i++) writePPU(ppu, 0x2000 + i, 1);
    for (let i = 0; i < 960; i++) writePPU(ppu, 0x2400 + i, 2);

    // Start with nametable 0, show BG
    ppu.cpuWrite(0x2000, 0x00);
    ppu.cpuWrite(0x2001, 0x0A);

    // Run some scanlines in top half
    ppu.tick(100 * 341);

    // Switch base nametable to $2400 mid-frame
    ppu.cpuWrite(0x2000, 0x01);

    // Finish frame
    ppu.tick((240 - 100) * 341);
    ppu.tick((262 - 240) * 341);

    const fb = (ppu as any).getFrameBuffer() as Uint8Array;

    // Verify somewhere in bottom area we see color 2 (tile 2) after the switch
    let found = false;
    for (let y = 120; y < 240 && !found; y++) {
      for (let x = 0; x < 64; x++) {
        if ((fb[y * 256 + x] & 0x3F) === 0x02) { found = true; break; }
      }
    }
    expect(found).toBe(true);
  });
});

