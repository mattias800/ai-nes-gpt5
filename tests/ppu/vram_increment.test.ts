import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

function setAddr(ppu: PPU, addr: number) {
  ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF);
  ppu.cpuWrite(0x2006, addr & 0xFF);
}

describe('PPU VRAM increment mode', () => {
  it('increments by 1 when $2000 bit2=0 and by 32 when bit2=1', () => {
    const ppu = new PPU();
    ppu.reset();

    // Write pattern at 0x2000 and 0x2001
    setAddr(ppu, 0x2000);
    ppu.cpuWrite(0x2007, 0x11);
    ppu.cpuWrite(0x2007, 0x22);

    // Read back with increment=1
    ppu.cpuWrite(0x2000, 0x00); // bit2=0
    setAddr(ppu, 0x2000);
    ppu.cpuRead(0x2007); // prime buffer
    const r1 = ppu.cpuRead(0x2007);
    const r2 = ppu.cpuRead(0x2007);
    expect(r1).toBe(0x11);
    expect(r2).toBe(0x22);

    // Now write a pattern across rows for increment=32
    setAddr(ppu, 0x2000);
    ppu.cpuWrite(0x2007, 0x33);
    setAddr(ppu, 0x2020); // next row (32 bytes)
    ppu.cpuWrite(0x2007, 0x44);

    // Read back with increment=32
    ppu.cpuWrite(0x2000, 0x04); // bit2=1
    setAddr(ppu, 0x2000);
    ppu.cpuRead(0x2007);
    const q1 = ppu.cpuRead(0x2007);
    const q2 = ppu.cpuRead(0x2007);
    expect(q1).toBe(0x33);
    expect(q2).toBe(0x44);
  });
});

