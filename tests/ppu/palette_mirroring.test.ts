import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

function setAddr(ppu: PPU, addr: number) {
  ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF);
  ppu.cpuWrite(0x2006, addr & 0xFF);
}

describe('PPU palette mirroring', () => {
  it('0x3F10/14/18/1C mirror 0x3F00/04/08/0C on write and read', () => {
    const ppu = new PPU();
    ppu.reset();

    const pairs: Array<[number, number, number]> = [
      [0x3F10, 0x3F00, 0x12],
      [0x3F14, 0x3F04, 0x34],
      [0x3F18, 0x3F08, 0x56],
      [0x3F1C, 0x3F0C, 0x78],
    ];

    for (const [mirror, base, valRaw] of pairs) {
      const val = valRaw & 0x3F; // Palette is 6-bit
      // Write to mirror, read from base
      setAddr(ppu, mirror);
      ppu.cpuWrite(0x2007, valRaw);
      setAddr(ppu, base);
      const r1 = ppu.cpuRead(0x2007);
      expect(r1).toBe(val);

      // Write to base, read from mirror
      setAddr(ppu, base);
      const other = ((val ^ 0x3F) & 0x3F);
      ppu.cpuWrite(0x2007, other);
      setAddr(ppu, mirror);
      const r2 = ppu.cpuRead(0x2007);
      expect(r2).toBe(other);
    }
  });
});
