import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

describe('PPU A12 rise per visible scanline (approx)', () => {
  it('calls hook once per scanline when rendering enabled', () => {
    const ppu = new PPU();
    ppu.reset();
    // Enable background rendering
    ppu.cpuWrite(0x2001, 0x08);

    let pulses = 0;
    ppu.setA12Hook(() => { pulses++; });

    // Tick through one visible scanline (341 cycles)
    ppu.tick(341);
    expect(pulses).toBe(1);

    // Tick through 10 more visible scanlines
    for (let i=0;i<10;i++) ppu.tick(341);
    expect(pulses).toBe(11);
  });
});
