import { describe, it, expect } from 'vitest';
import { parseINes } from '@core/cart/ines';

const makeNES20Header = (opts: {
  mapperLow: number; // lower 4 bits (byte 6 high nibble)
  nes2: boolean;
  submapper: number;
  prgBanks16k: number;
  chrBanks8k: number;
  prgRamNibble: number; // byte10 low
  prgNvNibble: number;  // byte10 high
  chrRamNibble: number; // byte11 low
  chrNvNibble: number;  // byte11 high
  timing: 0|1|2|3;      // byte12 low 2 bits
}) => {
  const h = new Uint8Array(16);
  h[0] = 0x4E; h[1] = 0x45; h[2] = 0x53; h[3] = 0x1A; // 'NES\u001A'
  h[4] = opts.prgBanks16k & 0xFF;
  h[5] = opts.chrBanks8k & 0xFF;
  // flags6: mapper low nibble in high 4 bits
  h[6] = ((opts.mapperLow & 0x0F) << 4);
  // flags7: NES 2.0 indicator in bits 2..3 = 0b10; upper nibble = 0 for mapper high nibble
  h[7] = (opts.nes2 ? 0x08 : 0x00);
  // byte8: high nibble mapper bits 8..11 (0), low nibble submapper
  h[8] = (opts.submapper & 0x0F);
  // byte9: PRG/CHR ROM MSBs (we keep 0 here so sizes remain small)
  h[9] = 0x00;
  // byte10: PRG RAM/NVRAM nibbles
  h[10] = ((opts.prgNvNibble & 0x0F) << 4) | (opts.prgRamNibble & 0x0F);
  // byte11: CHR RAM/NVRAM nibbles
  h[11] = ((opts.chrNvNibble & 0x0F) << 4) | (opts.chrRamNibble & 0x0F);
  // byte12: timing
  h[12] = (opts.timing & 0x03);
  return h;
};

describe('NES 2.0 parseINes', () => {
  it('parses submapper, RAM sizes, and timing (without requiring huge PRG/CHR)', () => {
    const hdr = makeNES20Header({
      mapperLow: 4,
      nes2: true,
      submapper: 4,
      prgBanks16k: 1,
      chrBanks8k: 0,
      prgRamNibble: 5,  // 64 << 5 = 2048
      prgNvNibble: 6,   // 64 << 6 = 4096
      chrRamNibble: 7,  // 64 << 7 = 8192
      chrNvNibble: 0,   // 0 => 0
      timing: 3,        // dendy
    });
    // Append PRG (16KB) so slicing succeeds
    const prg = new Uint8Array(16 * 1024);
    const romImage = new Uint8Array(16 + prg.length);
    romImage.set(hdr, 0);
    romImage.set(prg, 16);

    const rom = parseINes(romImage);
    expect(rom.isNES2).toBe(true);
    expect(rom.mapper).toBe(4);
    expect(rom.submapper).toBe(4);
    expect(rom.prg.length).toBe(16 * 1024);
    expect(rom.chr.length).toBe(0);
    expect(rom.prgRamSize).toBe(2048);
    expect(rom.prgNvramSize).toBe(4096);
    expect(rom.chrRamSize).toBe(8192);
    expect(rom.chrNvramSize).toBe(0);
    expect(rom.timing).toBe('dendy');
  });
});
