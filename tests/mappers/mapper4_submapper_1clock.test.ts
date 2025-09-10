import { describe, it, expect } from 'vitest';
import { parseINes } from '@core/cart/ines';
import { Cartridge } from '@core/cart/cartridge';
import { MMC3 } from '@core/cart/mappers/mmc3';

const makeNES2ROMBuffer = (submapper: number, prgBanks16k: number = 1) => {
  const h = new Uint8Array(16);
  h[0] = 0x4E; h[1] = 0x45; h[2] = 0x53; h[3] = 0x1A; // NES\u001A
  h[4] = prgBanks16k & 0xFF;
  h[5] = 0; // chrBanks
  h[6] = 0x40; // mapper low nibble = 4 in flags6 high
  h[7] = 0x08; // NES 2.0 indicator
  h[8] = (submapper & 0x0F); // submapper low nibble
  h[9] = 0x00; // no MSB extensions
  h[10] = 0x00; h[11] = 0x00; h[12] = 0x00;
  const prg = new Uint8Array(prgBanks16k * 16 * 1024);
  const buf = new Uint8Array(16 + prg.length);
  buf.set(h, 0);
  buf.set(prg, 16);
  return buf;
};

describe('Mapper 4 submapper -> MMC3 1-clocking policy', () => {
  it('submapper 5 enables MMC3 assertOnRel0 (1-clocking)', () => {
    const romBuf = makeNES2ROMBuffer(5, 1);
    const rom = parseINes(romBuf);
    const cart = new Cartridge(rom);
    const mapper = (cart as any).mapper as MMC3;
    expect(mapper).toBeInstanceOf(MMC3);
    // access internal flag
    expect((mapper as any)['assertOnRel0']).toBe(true);
  });
});
