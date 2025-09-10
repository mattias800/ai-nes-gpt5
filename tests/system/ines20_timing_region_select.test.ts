import { describe, it, expect } from 'vitest';
import { parseINes } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

const makeNES2 = (timing: 0|1|2|3) => {
  const h = new Uint8Array(16);
  h[0]=0x4E; h[1]=0x45; h[2]=0x53; h[3]=0x1A;
  h[4]=1; // 16KB PRG
  h[5]=0; // CHR ROM 0
  h[6]=0x00; // mapper 0
  h[7]=0x08; // NES 2.0
  h[8]=0x00; // submapper 0
  h[9]=0x00; // no MSB sizes
  h[10]=0x00; h[11]=0x00; // no RAM/NVRAM specified
  h[12]=timing & 0x03; // timing
  const prg = new Uint8Array(16*1024);
  const buf = new Uint8Array(16+prg.length);
  buf.set(h,0); buf.set(prg,16);
  return buf;
};

describe('NES 2.0 timing -> region selection', () => {
  it('sets PPU region to pal and APU region to PAL when timing=pal', () => {
    const romBuf = makeNES2(1);
    const rom = parseINes(romBuf);
    const sys = new NESSystem(rom);
    expect(sys.ppu.getRegion()).toBe('pal');
    expect((sys.apu as any).getRegion()).toBe('PAL');
  });
});
