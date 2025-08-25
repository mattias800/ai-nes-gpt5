import { describe, it, expect } from 'vitest';
import { MMC3 } from '@core/cart/mappers/mmc3';

describe('MMC3 IRQ counter via A12 rising edges', () => {
  it('reloads on first rise after $C001 and asserts IRQ when counter hits 0 with enable', () => {
    const prg = new Uint8Array(16 * 0x4000); // plenty
    const m = new MMC3(prg);

    // Set latch=3 (needs 4 rises to trigger)
    m.cpuWrite(0xC000, 3);
    // Request reload
    m.cpuWrite(0xC001, 0);
    // Enable IRQ
    m.cpuWrite(0xE001, 0);

    // First rise: reload to 3
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(false);
    // Second rise: 2
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(false);
    // Third rise: 1
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(false);
    // Fourth rise: 0 -> IRQ
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(true);
    m.clearIrq!();
    expect(m.irqPending!()).toBe(false);
  });
});
