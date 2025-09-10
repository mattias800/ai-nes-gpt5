import { describe, it, expect } from 'vitest';
import { Camerica } from '@core/cart/mappers/camerica';

describe('Camerica (71)', () => {
  it('banks 32KB PRG via low 4 bits', () => {
    const prg = new Uint8Array(0x8000 * 4);
    for (let b=0;b<4;b++) prg[b*0x8000]=0xB0+b;
    const m = new Camerica(prg, new Uint8Array(0));

    m.cpuWrite(0x8000 as any, 0x03);
    expect(m.cpuRead(0x8000 as any) & 0xFF).toBe(0xB0+3);
  });
});
