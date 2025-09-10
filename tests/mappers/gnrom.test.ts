import { describe, it, expect } from 'vitest';
import { GNROM } from '@core/cart/mappers/gnrom';

const mk = () => {
  const prg = new Uint8Array(0x8000 * 4); // 4 banks 32KB
  for (let b=0;b<4;b++) { const base=b*0x8000; prg[base]=0xB0+b; }
  const chr = new Uint8Array(0x2000 * 4);
  for (let b=0;b<4;b++) { const base=b*0x2000; chr[base]=0xC0+b; }
  return new GNROM(prg, chr);
};

describe('GNROM (66)', () => {
  it('banks 32KB PRG and 8KB CHR via single register', () => {
    const m = mk();
    // PRG bank 2 (value>>4), CHR bank 3 (value&3)
    m.cpuWrite(0x8000 as any, 0b00100011);
    expect(m.cpuRead(0x8000 as any) & 0xFF).toBe(0xB0+2);
    expect(m.ppuRead(0x0000 as any) & 0xFF).toBe(0xC0+3);
  });
});
