import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

// Ensure that when rendering is disabled (PPUMASK bg/sprite bits clear),
// the PPU does not produce A12 pulses during scanline ticking.

describe('PPU A12 pulses absent when rendering disabled', () => {
  it('produces zero pulses across multiple scanlines with mask=0', () => {
    const ppu = new PPU();
    ppu.reset();
    // Rendering stays disabled by default

    let pulses = 0;
    ppu.setA12Hook(() => { pulses++; });

    // Tick 20 visible scanlines worth of dots
    for (let i = 0; i < 20; i++) ppu.tick(341);

    expect(pulses).toBe(0);
  });
});

