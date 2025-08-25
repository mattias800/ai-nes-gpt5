import { describe, it, expect } from 'vitest';
import { CPUBus } from '@core/bus/memory';
import { NesIO } from '@core/io/nesio';
import { PPU } from '@core/ppu/ppu';

// Test OAM DMA copies 256 bytes from CPU page to PPU OAM starting at OAMADDR

describe('OAM DMA', () => {
  it('copies 256 bytes from CPU page', () => {
    const bus = new CPUBus();
    const ppu = new PPU();
    const io = new NesIO(ppu, bus);
    bus.connectIO(io.read, io.write);

    // Prepare CPU RAM page $0200..$02FF with pattern i
    for (let i = 0; i < 256; i++) {
      bus.write(0x0200 + i, i & 0xFF);
    }
    // Set OAMADDR to 0x10
    io.write(0x2003, 0x10);
    // Trigger DMA from page 0x02
    io.write(0x4014, 0x02);

    // Verify OAM[0x10]..[0x10+255] wraps and matches pattern
    let addr = 0x10;
    for (let i = 0; i < 256; i++) {
      const value = ppu.getOAMByte(addr);
      expect(value).toBe(i & 0xFF);
      addr = (addr + 1) & 0xFF;
    }
  });
});
