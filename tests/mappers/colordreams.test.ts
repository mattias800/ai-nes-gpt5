import { describe, it, expect } from 'vitest';
import { ColorDreams } from '@core/cart/mappers/colordreams';

describe('Color Dreams (11)', () => {
  it('banks 32KB PRG (bits 4..7) and 8KB CHR (bits 0..3)', () => {
    const prg = new Uint8Array(0x8000 * 8);
    for (let b=0;b<8;b++) prg[b*0x8000]=0xB0+b;
    const chr = new Uint8Array(0x2000 * 16);
    for (let b=0;b<16;b++) chr[b*0x2000]=0xC0+b;
    const m = new ColorDreams(prg, chr);

    m.cpuWrite(0x8000 as any, 0x23); // PRG=2, CHR=3
    expect(m.cpuRead(0x8000 as any) & 0xFF).toBe(0xB0+2);
    expect(m.ppuRead(0x0000 as any) & 0xFF).toBe(0xC0+3);
  });
});
