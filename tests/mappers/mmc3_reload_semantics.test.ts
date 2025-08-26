import { describe, it, expect } from 'vitest';
import { MMC3 } from '@core/cart/mappers/mmc3';

describe('MMC3 reload semantics via $C001 mid-sequence', () => {
  it('reloads on next rise after $C001, then continues decrementing', () => {
    const prg = new Uint8Array(16 * 0x4000);
    const m = new MMC3(prg);

    // Latch=2, request reload, enable IRQ
    m.cpuWrite(0xC000, 2);
    m.cpuWrite(0xC001, 0);
    m.cpuWrite(0xE001, 0);

    // First rise: reload->2 (no IRQ)
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(false);

    // Second: dec 2->1 (no IRQ)
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(false);

    // Request reload again mid-sequence
    m.cpuWrite(0xC001, 0);

    // Next rise: reload->2 (no IRQ)
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(false);

    // Next two rises: 2->1 (no IRQ), 1->0 (IRQ)
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(false);
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(true);
  });
});

