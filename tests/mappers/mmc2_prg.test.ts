import { describe, it, expect } from 'vitest';
import { MMC2 } from '@core/cart/mappers/mmc2';

function makePRG(banks16k: number): Uint8Array {
  const prg = new Uint8Array(banks16k * 0x4000);
  for (let b = 0; b < banks16k; b++) prg.fill(b & 0xFF, b * 0x4000, (b + 1) * 0x4000);
  return prg;
}

describe('Mapper9: MMC2 PRG mapping', () => {
  it('switches 16KB bank at $8000 via $A000; keeps last 16KB fixed at $C000', () => {
    const prg = makePRG(3); // banks 0,1,2
    const chr = new Uint8Array(0x2000);
    const m = new MMC2(prg, chr);

    // Default: bank 0 at $8000, last bank (2) fixed at $C000
    expect(m.cpuRead(0x8000 as any)).toBe(0);
    expect(m.cpuRead(0xBFFF as any)).toBe(0);
    expect(m.cpuRead(0xC000 as any)).toBe(2);
    expect(m.cpuRead(0xFFFF as any)).toBe(2);

    // Select bank 1 via $A000
    m.cpuWrite(0xA000 as any, 1);
    expect(m.cpuRead(0x8000 as any)).toBe(1);
    expect(m.cpuRead(0x9FFF as any)).toBe(1);
    expect(m.cpuRead(0xC000 as any)).toBe(2);

    // Out-of-range selects modulo
    m.cpuWrite(0xA000 as any, 7); // 7 % 3 = 1
    expect(m.cpuRead(0x8000 as any)).toBe(1);

    // PRG RAM R/W
    m.cpuWrite(0x6000 as any, 0xAB);
    expect(m.cpuRead(0x6000 as any)).toBe(0xAB);
  });
});

