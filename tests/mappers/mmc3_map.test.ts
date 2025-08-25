import { describe, it, expect } from 'vitest';
import { MMC3 } from '@core/cart/mappers/mmc3';

function makePRG(size16k: number): Uint8Array {
  const prg = new Uint8Array(size16k * 0x4000);
  const banks8k = size16k * 2;
  for (let b = 0; b < banks8k; b++) prg.fill(b, b * 0x2000, (b + 1) * 0x2000);
  return prg;
}

describe('Mapper4: MMC3 PRG mapping', () => {
  it('maps banks according to mode and registers', () => {
    const prg = makePRG(8); // 8 * 16KB = 128KB
    const m = new MMC3(prg);

    // Set bank select R6/R7 values
    // Write bank select register: select R6 (reg=6, mode=0)
    m.cpuWrite(0x8000, 0x06);
    m.cpuWrite(0x8001, 0x01); // R6=1
    m.cpuWrite(0x8000, 0x07);
    m.cpuWrite(0x8001, 0x02); // R7=2

    // mode 0: $8000=R6 (1), $A000=R7 (2), $C000=fixed second-last (14), $E000=last (15)
    expect(m.cpuRead(0x8000)).toBe(1);
    expect(m.cpuRead(0xA000)).toBe(2);
    expect(m.cpuRead(0xC000)).toBe(14);
    expect(m.cpuRead(0xE000)).toBe(15);

    // Set PRG mode bit (bit6)
    m.cpuWrite(0x8000, 0x46); // reg=6, PRG mode=1
    expect(m.cpuRead(0x8000)).toBe(14); // fixed second-last
    expect(m.cpuRead(0xC000)).toBe(1); // R6 now at $C000
  });
});
