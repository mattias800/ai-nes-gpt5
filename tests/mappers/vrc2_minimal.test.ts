import { describe, it, expect } from 'vitest';
import { VRC2_4 } from '@core/cart/mappers/vrc2_4';

const mk = () => {
  const prg = new Uint8Array(0x4000 * 8); // 8 banks of 16KB
  for (let b=0;b<8;b++) { prg[b*0x4000] = 0xB0 + b; }
  const chr = new Uint8Array(0x2000 * 8); // 8 banks of 8KB
  for (let b=0;b<8;b++) { chr[b*0x2000] = 0xC0 + b; }
  return new VRC2_4(prg, chr, 22);
};

describe('VRC2/4 minimal', () => {
  it('banks 16KB PRG via $8000', () => {
    const m = mk();
    m.cpuWrite(0x8000 as any, 0x03);
    expect(m.cpuRead(0x8000 as any) & 0xFF).toBe(0xB0+3);
  });
  it('banks 8KB CHR via $A000', () => {
    const m = mk();
    m.cpuWrite(0xA000 as any, 0x05);
    expect(m.ppuRead(0x0000 as any) & 0xFF).toBe(0xC0+5);
  });
});
