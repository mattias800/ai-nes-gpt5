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

describe('PPU sprite overflow (bit5)', () => {
  it('sets sprite overflow when more than 8 sprites are on a scanline and clears at new frame', () => {
    const ppu = new PPU();
    ppu.reset();

    // Enable sprites
    ppu.cpuWrite(0x2001, 0x10);

    // Put 9 sprites covering scanline y=50. OAM Y is top-1, so set to 49.
    // Use tile 0, attr 0, x spread out
    for (let i = 0; i < 9; i++) {
      ppu.cpuWrite(0x2003, (i * 4) & 0xFF);
      ppu.cpuWrite(0x2004, 49);      // Y (so visible at scanline 50)
      ppu.cpuWrite(0x2004, 0);       // tile
      ppu.cpuWrite(0x2004, 0);       // attr
      ppu.cpuWrite(0x2004, (i * 8) & 0xFF); // X
    }

    // Advance to scanline 50, cycle 2
    for (let sl = 0; sl < 50; sl++) {
      ppu.tick(341);
    }
    ppu.tick(2);

    // Read PPUSTATUS: bit5 (0x20) should be set
    const st = ppu.cpuRead(0x2002);
    expect((st & 0x20) !== 0).toBe(true);

    // Advance to end of frame and into next pre-render to clear overflow
    for (let sl = 50; sl < 262; sl++) ppu.tick(341);

    // At start of next frame (after pre-render), overflow should be cleared
    const st2 = ppu.cpuRead(0x2002);
    expect((st2 & 0x20) !== 0).toBe(false);
  });

  it('does not set overflow when 8 or fewer sprites are on a scanline', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.cpuWrite(0x2001, 0x10);

    // Clear OAM to keep other sprites off-screen (Y=0xF0)
    ppu.cpuWrite(0x2003, 0x00);
    for (let i = 0; i < 64; i++) {
      ppu.cpuWrite(0x2004, 0xF0); // Y far below visible
      ppu.cpuWrite(0x2004, 0x00); // tile
      ppu.cpuWrite(0x2004, 0x00); // attr
      ppu.cpuWrite(0x2004, 0x00); // X
    }

    // Put exactly 8 sprites on scanline 60
    for (let i = 0; i < 8; i++) {
      ppu.cpuWrite(0x2003, (i * 4) & 0xFF);
      ppu.cpuWrite(0x2004, 59);
      ppu.cpuWrite(0x2004, 0);
      ppu.cpuWrite(0x2004, 0);
      ppu.cpuWrite(0x2004, (i * 8) & 0xFF);
    }

    for (let sl = 0; sl < 60; sl++) ppu.tick(341);
    ppu.tick(2);

    const st = ppu.cpuRead(0x2002);
    expect((st & 0x20) !== 0).toBe(false);
  });
});

