import { describe, it, expect } from 'vitest';
import { CNROM } from '@core/cart/mappers/cnrom';

describe('Mapper3: CNROM CHR switching', () => {
  it('switches 8KB CHR bank at $0000', () => {
    const prg = new Uint8Array(0x8000).fill(0);
    const chr = new Uint8Array(0x6000); // 3 banks of 8KB
    // Fill bank 0 with 0x11, bank 1 with 0x22, bank 2 with 0x33
    chr.fill(0x11, 0x0000, 0x2000);
    chr.fill(0x22, 0x2000, 0x4000);
    chr.fill(0x33, 0x4000, 0x6000);

    const m = new CNROM(prg, chr);
    // default bank 0
    expect(m.ppuRead(0x0000)).toBe(0x11);
    // switch to bank 1
    m.cpuWrite(0x8000, 0x01);
    expect(m.ppuRead(0x0000)).toBe(0x22);
    // switch to bank 2
    m.cpuWrite(0x8000, 0x02);
    expect(m.ppuRead(0x1000)).toBe(0x33);
  });
});
