import { describe, it, expect } from 'vitest';
import { MMC2 } from '@core/cart/mappers/mmc2';

function makeCHR4kBanks(banks: number, fill: number[]): Uint8Array {
  const chr = new Uint8Array(banks * 0x1000);
  for (let b = 0; b < banks; b++) chr.fill((fill[b] ?? (b + 1)) & 0xFF, b * 0x1000, (b + 1) * 0x1000);
  return chr;
}

describe('Mapper9: MMC2 CHR latch semantics (reads)', () => {
  it('switches lower/upper halves between FD/FE banks based on FD8/FE8 triggers', () => {
    // 4 banks of 4KB: 0x11, 0x22, 0x33, 0x44
    const chr = makeCHR4kBanks(4, [0x11, 0x22, 0x33, 0x44]);
    const prg = new Uint8Array(0x8000);
    const m = new MMC2(prg, chr);

    // Program FD/FE regs
    m.cpuWrite(0xB000 as any, 1); // lower FD -> bank 1 (0x22)
    m.cpuWrite(0xC000 as any, 0); // lower FE -> bank 0 (0x11)
    m.cpuWrite(0xD000 as any, 3); // upper FD -> bank 3 (0x44)
    m.cpuWrite(0xE000 as any, 2); // upper FE -> bank 2 (0x33)

    // Default latches FE
    expect(m.ppuRead(0x0000 as any)).toBe(0x11); // lower FE
    expect(m.ppuRead(0x1000 as any)).toBe(0x33); // upper FE

    // Trigger lower FD via 0x0FD8
    m.ppuRead(0x0FD8 as any);
    expect(m.ppuRead(0x0000 as any)).toBe(0x22);

    // Trigger lower FE via 0x0FE8
    m.ppuRead(0x0FE8 as any);
    expect(m.ppuRead(0x0000 as any)).toBe(0x11);

    // Trigger upper FD via 0x1FD8
    m.ppuRead(0x1FD8 as any);
    expect(m.ppuRead(0x1000 as any)).toBe(0x44);

    // Trigger upper FE via 0x1FE8
    m.ppuRead(0x1FE8 as any);
    expect(m.ppuRead(0x1000 as any)).toBe(0x33);
  });
});

