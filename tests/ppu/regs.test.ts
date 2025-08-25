import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

describe('PPU registers and status latch', () => {
  it('PPUSTATUS vblank flag set/cleared and w reset on read', () => {
    const ppu = new PPU();
    ppu.reset();
    // Tick into vblank
    ppu.tick(241 * 341 + 1);
    // VBlank should be set
    // Read $2002
    const v1 = ppu.cpuRead(0x2002);
    expect((v1 & 0x80) !== 0).toBe(true);
    // Read clears vblank and write toggle
    const v2 = ppu.cpuRead(0x2002);
    expect((v2 & 0x80) !== 0).toBe(false);
  });

  it('$2005/$2006 write toggles and affects v/t/x', () => {
    const ppu = new PPU();
    ppu.reset();
    // Write scroll X=5
    ppu.cpuWrite(0x2005, 5);
    // Write scroll Y=10
    ppu.cpuWrite(0x2005, 10);
    // Write high byte of addr
    ppu.cpuWrite(0x2006, 0x21);
    // Write low byte
    ppu.cpuWrite(0x2006, 0x23);
    // Now writes to $2007 should go to 0x2123 and post-increment
    ppu.cpuWrite(0x2007, 0xAA);
    ppu.cpuWrite(0x2007, 0xBB);
    // Reset address and read back
    ppu.cpuWrite(0x2006, 0x21);
    ppu.cpuWrite(0x2006, 0x23);
    // first read returns buffer (initially 0)
    const r0 = ppu.cpuRead(0x2007);
    const r1 = ppu.cpuRead(0x2007);
    expect(r0).toBe(0x00);
    expect(r1).toBe(0xAA);
  });
});
