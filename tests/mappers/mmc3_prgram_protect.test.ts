import { describe, it, expect } from 'vitest';
import { MMC3 } from '@core/cart/mappers/mmc3';

function makePRG(size16k: number): Uint8Array {
  const prg = new Uint8Array(size16k * 0x4000);
  return prg;
}

describe('MMC3 PRG-RAM protect/enable semantics (A001)', () => {
  it('gates reads/writes based on A001 bits (bit7 enable, bit6 write-protect)', () => {
    const prg = makePRG(2);
    const m = new MMC3(prg);

    // Default: disabled -> reads 0x00, writes ignored
    m.cpuWrite(0x6000, 0x12);
    expect(m.cpuRead(0x6000)).toBe(0x00);

    // Enable RAM (bit7=1), write enable (bit6=0)
    m.cpuWrite(0xA001, 0x80);
    m.cpuWrite(0x6000, 0x34);
    expect(m.cpuRead(0x6000)).toBe(0x34);

    // Enable + write protect (bit7=1, bit6=1) -> reads allowed, writes ignored
    m.cpuWrite(0xA001, 0xC0);
    m.cpuWrite(0x6000, 0x56);
    expect(m.cpuRead(0x6000)).toBe(0x34);

    // Disable again -> reads 0x00, writes ignored
    m.cpuWrite(0xA001, 0x00);
    m.cpuWrite(0x6000, 0x78);
    expect(m.cpuRead(0x6000)).toBe(0x00);
  });
});

