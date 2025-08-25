import { describe, it, expect } from 'vitest';
import { UxROM } from '@core/cart/mappers/uxrom';

function makePRG(banks: number): Uint8Array {
  const prg = new Uint8Array(banks * 0x4000);
  for (let b = 0; b < banks; b++) {
    prg.fill(b, b * 0x4000, (b + 1) * 0x4000);
  }
  return prg;
}

describe('Mapper2: UxROM PRG switching', () => {
  it('switches 16KB bank at $8000-$BFFF and keeps last bank fixed', () => {
    const prg = makePRG(4); // 4 banks of 16KB with values 0,1,2,3
    const m = new UxROM(prg);

    // Initially bank 0 at $8000
    expect(m.cpuRead(0x8000)).toBe(0);
    expect(m.cpuRead(0xBFFF)).toBe(0);
    // Fixed last bank (3) at $C000
    expect(m.cpuRead(0xC000)).toBe(3);
    expect(m.cpuRead(0xFFFF)).toBe(3);

    // Select bank 2
    m.cpuWrite(0x8000, 2);
    expect(m.cpuRead(0x8000)).toBe(2);
    expect(m.cpuRead(0x9FFF)).toBe(2);
    expect(m.cpuRead(0xC000)).toBe(3);
  });
});
