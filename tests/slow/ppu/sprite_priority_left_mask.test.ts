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

describe('PPU sprite priority with left-edge masks', () => {
  it('when bg left is disabled and sprite left is enabled, behind sprite shows at x<8', () => {
    const ppu = new PPU();
    ppu.reset();

    // CHR: tile 1 => pix=1
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF;
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Palettes
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F10, 0x00);
    writePPU(ppu, 0x3F11, 0x05);

    // BG tile at (0,0) -> non-zero bg pix at left edge
    writePPU(ppu, 0x2000 + 0, 1);

    // Disable bg left (bit1=0), enable sprite left (bit2=1), enable bg+sprites (bits3,4)
    ppu.cpuWrite(0x2001, 0x1C); // 0001 1100 -> bg left off, sp left on, bg on, sp on

    // Place sprite 0 at x=4,y=0 with priority behind (bit5=1)
    ppu.cpuWrite(0x2003, 0);
    ppu.cpuWrite(0x2004, 255); // Y such that sy=(255+1)&0xFF=0 -> on-screen y starts at 0
    ppu.cpuWrite(0x2004, 1); // tile
    ppu.cpuWrite(0x2004, 0x20); // attr: behind
    ppu.cpuWrite(0x2004, 4); // X within left 8

    const fb = (ppu as any).renderFrame() as Uint8Array;
    const color = fb[0 * 256 + 4] & 0x3F;
    // Expect sprite visible (color 5 from sprite palette), even though bg tile is non-zero, because bg left is masked
    expect(color).toBe(5);
  });
});

