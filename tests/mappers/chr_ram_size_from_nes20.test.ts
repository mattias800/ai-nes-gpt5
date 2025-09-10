import { describe, it, expect } from 'vitest';
import { parseINes } from '@core/cart/ines';
import { Cartridge } from '@core/cart/cartridge';

const makeNES2_NROM_withChrRam = (chrRamNibble: number) => {
  const h = new Uint8Array(16);
  h[0]=0x4E; h[1]=0x45; h[2]=0x53; h[3]=0x1A;
  h[4]=1; // 16KB PRG
  h[5]=0; // 0 CHR ROM
  h[6]=0x00; // mapper 0
  h[7]=0x08; // NES 2.0
  h[8]=0x00; // submapper
  h[9]=0x00;
  h[10]=(0x0<<4) | 0x0; // prg nv/ram 0
  h[11]=(0x0<<4) | (chrRamNibble & 0x0F); // chr nvram 0, chr ram nibble
  h[12]=0x00;
  const prg = new Uint8Array(16*1024);
  const buf = new Uint8Array(16+prg.length);
  buf.set(h,0); buf.set(prg,16);
  return buf;
};

describe('CHR RAM sizing from NES 2.0', () => {
  it('allocates CHR RAM size per header when no CHR ROM (mapper 0)', () => {
    // chrRamNibble=8 -> size=64<<8 = 16384
    const romBuf = makeNES2_NROM_withChrRam(8);
    const rom = parseINes(romBuf);
    const cart = new Cartridge(rom);
    const mapper: any = (cart as any).mapper;
    expect(mapper['chr'].length).toBe(16384);
  });
});
