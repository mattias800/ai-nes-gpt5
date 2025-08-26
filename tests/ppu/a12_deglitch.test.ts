import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

// This test exercises the PPU's A12 deglitch filter by generating CHR reads
// through the CPU interface ($2006/$2007) and varying the number of PPU dots
// between a low (A12=0) and a subsequent high (A12=1) access. Only if the low
// period is at least the filter length (8 dots) should a rising edge be counted.

describe('PPU A12 deglitch filter', () => {
  it('counts rising edges only when A12 has been low for >= 8 dots', () => {
    const ppu = new PPU();
    ppu.reset();

    // Keep rendering disabled to avoid synthetic fetches interfering with the test
    // (mask defaults to 0 after reset). No need to call cpuWrite(0x2001, 0).

    let pulses = 0;
    ppu.setA12Hook(() => { pulses++; });

    // Helpers to drive CHR access via CPU $2006/$2007
    function setAddr(addr14: number) {
      // Write high then low byte of PPUADDR; only 14 bits are used
      ppu.cpuWrite(0x2006, (addr14 >> 8) & 0x3F);
      ppu.cpuWrite(0x2006, addr14 & 0xFF);
    }
    function readAt(addr14: number) {
      setAddr(addr14 & 0x3FFF);
      // Reading PPUDATA triggers an internal ppuRead at v, which runs the A12 logic
      ppu.cpuRead(0x2007);
    }

    // 1) Immediate high with no preceding low period >= 8 dots -> not counted
    readAt(0x1000); // A12=1 at dot 0; last low dot = 0 (from reset), delta=0 < 8
    expect(pulses).toBe(0);

    // 2) Another high back-to-back -> not counted (still high, no 0->1 transition)
    readAt(0x1000);
    expect(pulses).toBe(0);

    // 3) Brief low then short wait (<8 dots), then high -> not counted
    readAt(0x0FF8); // A12=0, records low-dot
    ppu.tick(4);    // advance 4 dots, below filter threshold
    readAt(0x1000); // A12=1 but low period too short
    expect(pulses).toBe(0);

    // 4) Proper low then wait >=8 dots, then high -> counted
    readAt(0x0FF8); // A12=0
    ppu.tick(8);    // exactly at threshold
    readAt(0x1000); // A12=1 -> should count
    expect(pulses).toBe(1);

    // 5) Another valid cycle with longer wait -> counted
    readAt(0x0FF8); // A12=0
    ppu.tick(12);   // comfortably above threshold
    readAt(0x1000); // A12=1 -> count
    expect(pulses).toBe(2);
  });
});

