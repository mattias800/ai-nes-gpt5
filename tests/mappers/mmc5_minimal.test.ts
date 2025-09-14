import { describe, it, expect } from 'vitest';
import { MMC5 } from '@core/cart/mappers/mmc5';

// Helpers to make a PRG and CHR ROM with identifiable data
const makePrg = (size: number) => {
  const prg = new Uint8Array(size);
  for (let i = 0; i < size; i += 0x2000) prg.fill((i / 0x2000) & 0xFF, i, i + 0x2000);
  return prg;
};
const makeChr = (size: number) => {
  const chr = new Uint8Array(size);
  for (let i = 0; i < size; i += 0x0400) chr.fill((i / 0x0400) & 0xFF, i, i + 0x0400);
  return chr;
};

describe('Mapper 5 (MMC5) basic functionality', () => {
  it('PRG banking 8KB slots map correctly', () => {
    const prg = makePrg(0x20000); // 128KB
    const m = new MMC5(prg, makeChr(0x2000));
    // Set banks: $8000=$02, $A000=$04, $C000=$06, $E000=$07
    m.cpuWrite(0x5114, 0x02);
    m.cpuWrite(0x5115, 0x04);
    m.cpuWrite(0x5116, 0x06);
    m.cpuWrite(0x5113, 0x07);
    expect(m.cpuRead(0x8000)).toBe(0x02);
    expect(m.cpuRead(0xA000)).toBe(0x04);
    expect(m.cpuRead(0xC000)).toBe(0x06);
    expect(m.cpuRead(0xE000)).toBe(0x07);
  });

  it('CHR 1KB banking works', () => {
    const prg = makePrg(0x40000);
    const chr = makeChr(0x4000); // 16KB => 16x1KB banks
    const m = new MMC5(prg, chr);
    // Map banks 8..15 to slots 0..7
    for (let i = 0; i < 8; i++) m.cpuWrite(0x5120 + i, 8 + i);
    // Expect PPU reads sample the bank byte pattern at each 1KB region
    for (let slot = 0; slot < 8; slot++) {
      const addr = (slot * 0x400) + 0x100; // middle of the 1KB slot
      expect(m.ppuRead(addr)).toBe(8 + slot);
    }
  });

  it('Nametable override with fill mode returns fill tile/attr', () => {
    const prg = makePrg(0x20000);
    const chr = makeChr(0x2000);
    const m = new MMC5(prg, chr);
    // Set NT sources for all quadrants to Fill (3)
    m.cpuWrite(0x5105, 0b11111111);
    m.cpuWrite(0x5106, 0xAA); // fill tile
    m.cpuWrite(0x5107, 0x55); // fill attr
    // Name table area
    expect(m.ppuNTRead(0x2000)).toBe(0xAA);
    expect(m.ppuNTRead(0x23C0)).toBe(0x55); // attribute region
  });

  it('Multiplier and status registers work', () => {
    const prg = makePrg(0x20000);
    const chr = makeChr(0x2000);
    const m = new MMC5(prg, chr);
    m.cpuWrite(0x5205, 7);
    m.cpuWrite(0x5206, 9);
    // low byte is write-only in real hw, we expose MUL A low readback for simplicity
    expect(m.cpuRead(0x5205)).toBe(7);
    expect(m.cpuRead(0x5206)).toBe(((7 * 9) >>> 8) & 0xFF);
    // IRQ status bit7 reflects line when enabled via 0x5204
    m.cpuWrite(0x5204, 0x80); // enable
    // tick with a fake time provider later; here just check that status reflects inFrame flag default false
    expect(m.cpuRead(0x5204) & 0x80).toBe(0); // no IRQ yet
  });
});

