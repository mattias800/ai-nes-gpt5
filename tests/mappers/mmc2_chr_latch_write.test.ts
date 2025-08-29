import { describe, it, expect } from 'vitest';
import { MMC2 } from '@core/cart/mappers/mmc2';

function makeCHR4kBanks(banks: number, fill: number[]): Uint8Array {
  const chr = new Uint8Array(banks * 0x1000);
  for (let b = 0; b < banks; b++) chr.fill((fill[b] ?? (b + 1)) & 0xFF, b * 0x1000, (b + 1) * 0x1000);
  return chr;
}

describe('Mapper9: MMC2 CHR latch semantics (writes)', () => {
  it('latch changes via CHR writes also affect mapping', () => {
    const chr = makeCHR4kBanks(4, [0x11, 0x22, 0x33, 0x44]);
    const prg = new Uint8Array(0x8000);
    const m = new MMC2(prg, chr);

    // Program FD/FE regs: upper FD=3 (0x44), FE=2 (0x33)
    m.cpuWrite(0xD000 as any, 3);
    m.cpuWrite(0xE000 as any, 2);

    // Default FE
    expect(m.ppuRead(0x1000 as any)).toBe(0x33);

    // Write to trigger FD
    m.ppuWrite(0x1FD8 as any, 0xAA);
    expect(m.ppuRead(0x1000 as any)).toBe(0x44);

    // Write to trigger FE
    m.ppuWrite(0x1FE8 as any, 0xBB);
    expect(m.ppuRead(0x1000 as any)).toBe(0x33);
  });
});

