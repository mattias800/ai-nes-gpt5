import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

// Additional edge coverage around the A12 deglitch filter threshold.
// Ensure 7-dot low period does not count, while 8-dot low period does.
describe('PPU A12 deglitch borderline edges', () => {
  it('7-dot low -> no count; 8-dot low -> count', () => {
    const ppu = new PPU();
    ppu.reset();

    let pulses = 0;
    ppu.setA12Hook(() => { pulses++; });

    function setAddr(addr14: number) {
      ppu.cpuWrite(0x2006, (addr14 >> 8) & 0x3F);
      ppu.cpuWrite(0x2006, addr14 & 0xFF);
    }
    function readAt(addr14: number) {
      setAddr(addr14 & 0x3FFF);
      ppu.cpuRead(0x2007);
    }

    // 7-dot low -> no count
    readAt(0x0FF8); // A12=0
    ppu.tick(7);
    readAt(0x1000); // A12=1
    expect(pulses).toBe(0);

    // 8-dot low -> count
    readAt(0x0FF8); // A12=0
    ppu.tick(8);
    readAt(0x1000); // A12=1 -> count
    expect(pulses).toBe(1);
  });
});

