import { describe, it, expect } from 'vitest';
import { FME7 } from '@core/cart/mappers/fme7';

function makePRG8(banks8k: number): Uint8Array {
  const prg = new Uint8Array(banks8k * 0x2000);
  for (let b = 0; b < banks8k; b++) prg.fill(b & 0xFF, b * 0x2000, (b + 1) * 0x2000);
  return prg;
}
function makeCHR1k(banks1k: number): Uint8Array {
  const chr = new Uint8Array(banks1k * 0x400);
  for (let b = 0; b < banks1k; b++) chr.fill(b & 0xFF, b * 0x400, (b + 1) * 0x400);
  return chr;
}

describe('Mapper69: FME-7 minimal PRG/CHR mapping', () => {
  it('maps 8KB PRG banks to $8000/$A000/$C000/$E000 slots', () => {
    const prg = makePRG8(8); // 8 banks of 8KB => 64KB
    const chr = makeCHR1k(8);
    const m = new FME7(prg, chr);

    // Default: $E000 fixed to last bank, others low banks
    expect(m.cpuRead(0x8000 as any)).toBe(0);
    expect(m.cpuRead(0xA000 as any)).toBe(1);
    expect(m.cpuRead(0xC000 as any)).toBe(2);
    expect(m.cpuRead(0xE000 as any)).toBe(7);

    // Select register 8 ($8000 slot) and write bank 3
    m.cpuWrite(0x8000 as any, 8);
    m.cpuWrite(0xA000 as any, 3);
    expect(m.cpuRead(0x8000 as any)).toBe(3);

    // Select register 11 ($E000 slot) and write bank 5
    m.cpuWrite(0x8000 as any, 11);
    m.cpuWrite(0xA000 as any, 5);
    expect(m.cpuRead(0xE000 as any)).toBe(5);
  });

  it('maps 1KB CHR banks across $0000-$1FFF', () => {
    const prg = makePRG8(4);
    const chr = makeCHR1k(16); // 16 banks to test wrapping
    const m = new FME7(prg, chr);

    // Program CHR banks 0..7 to 8..15 respectively
    for (let i = 0; i < 8; i++) {
      m.cpuWrite(0x8000 as any, i);
      m.cpuWrite(0xA000 as any, 8 + i);
    }
    // Each 1KB region should read its bank id
    for (let i = 0; i < 8; i++) {
      const base = i * 0x400;
      expect(m.ppuRead(base as any)).toBe((8 + i) & 0xFF);
      expect(m.ppuRead((base + 0x3FF) as any)).toBe((8 + i) & 0xFF);
    }
  });

  it('supports PRG-RAM R/W and mirroring control callback', () => {
    const prg = makePRG8(2);
    const chr = makeCHR1k(8);
    const m = new FME7(prg, chr, undefined, 0x2000, 0);

    // PRG-RAM
    m.cpuWrite(0x6000 as any, 0xAB);
    expect(m.cpuRead(0x6000 as any)).toBe(0xAB);

    // Mirroring
    let seen: string[] = [];
    m.setMirrorCallback((mode) => seen.push(mode));
    m.cpuWrite(0x8000 as any, 12);
    m.cpuWrite(0xA000 as any, 0); // vertical
    m.cpuWrite(0xA000 as any, 1); // horizontal
    m.cpuWrite(0xA000 as any, 2); // single0
    m.cpuWrite(0xA000 as any, 3); // single1
    expect(seen).toEqual(['vertical','horizontal','single0','single1']);
  });
});

