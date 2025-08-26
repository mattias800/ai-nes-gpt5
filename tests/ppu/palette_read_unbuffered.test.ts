import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

function setAddr(ppu: PPU, addr: number) {
  ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF);
  ppu.cpuWrite(0x2006, addr & 0xFF);
}

describe('PPU palette read buffering vs nametable buffering', () => {
  it('palette reads via $2007 are unbuffered while nametable reads are buffered', () => {
    const ppu = new PPU();
    ppu.reset();

    // Write a nametable value at 0x2000
    setAddr(ppu, 0x2000);
    ppu.cpuWrite(0x2007, 0x5A);

    // Read back nametable with buffering: first read is buffer (initially 0), second is real
    setAddr(ppu, 0x2000);
    const n0 = ppu.cpuRead(0x2007);
    const n1 = ppu.cpuRead(0x2007);
    expect(n0).toBe(0x00);
    expect(n1).toBe(0x5A);

    // Write a palette value at 0x3F00
    setAddr(ppu, 0x3F00);
    ppu.cpuWrite(0x2007, 0x2B);

    // Palette reads are unbuffered: first read returns actual palette, not the buffer
    setAddr(ppu, 0x3F00);
    const p0 = ppu.cpuRead(0x2007);
    expect((p0 & 0x3F)).toBe(0x2B);
  });
});

