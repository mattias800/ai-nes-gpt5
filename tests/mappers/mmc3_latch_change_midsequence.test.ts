import { describe, it, expect } from 'vitest';
import { MMC3 } from '@core/cart/mappers/mmc3';

describe('MMC3 latch change mid-sequence', () => {
  it('changing latch before reload causes next reload to use new value', () => {
    const prg = new Uint8Array(16 * 0x4000);
    const m = new MMC3(prg);

    // Set latch=3, request reload, enable
    m.cpuWrite(0xC000, 3);
    m.cpuWrite(0xC001, 0);
    m.cpuWrite(0xE001, 0);

    // First rise: reload->3
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(false);

    // Change latch to 1 and request reload
    m.cpuWrite(0xC000, 1);
    m.cpuWrite(0xC001, 0);

    // Next rise: reload->1
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(false);

    // Next rise: 1->0 -> IRQ
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(true);
  });
});

