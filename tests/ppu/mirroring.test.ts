import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

function writeRead(ppu: PPU, a: number, v: number, b: number) {
  ppu.cpuWrite(0x2006, (a >> 8) & 0xFF);
  ppu.cpuWrite(0x2006, a & 0xFF);
  ppu.cpuWrite(0x2007, v);
  ppu.cpuWrite(0x2006, (b >> 8) & 0xFF);
  ppu.cpuWrite(0x2006, b & 0xFF);
  // First read returns buffered; second returns real
  ppu.cpuRead(0x2007);
  return ppu.cpuRead(0x2007);
}

describe('PPU nametable mirroring', () => {
  it('vertical: $2000 mirrors $2800, $2400 mirrors $2C00', () => {
    const ppu = new PPU('vertical');
    ppu.reset();
    const v = writeRead(ppu, 0x2000, 0x55, 0x2800);
    expect(v).toBe(0x55);
    const v2 = writeRead(ppu, 0x2400, 0x66, 0x2C00);
    expect(v2).toBe(0x66);
  });
  it('horizontal: $2000 mirrors $2400, $2800 mirrors $2C00', () => {
    const ppu = new PPU('horizontal');
    ppu.reset();
    const v = writeRead(ppu, 0x2000, 0x77, 0x2400);
    expect(v).toBe(0x77);
    const v2 = writeRead(ppu, 0x2800, 0x88, 0x2C00);
    expect(v2).toBe(0x88);
  });
});
