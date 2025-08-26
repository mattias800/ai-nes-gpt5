import { describe, it, expect } from 'vitest';
import { MMC3 } from '@core/cart/mappers/mmc3';

// Additional gating: ensure reload-on-next-rise and enable/disable behavior interlock

describe('MMC3 IRQ reload + enable gating (edge cases)', () => {
  it('reload requested while disabled; enable before next rise still requires decrement to 0', () => {
    const mmc3 = new MMC3(new Uint8Array(0x8000));

    // Latch=1
    mmc3.cpuWrite(0xC000, 1);
    // Request reload
    mmc3.cpuWrite(0xC001, 0);
    // Keep disabled
    mmc3.cpuWrite(0xE000, 0);

    // First rise: reload->1 (no IRQ)
    mmc3.notifyA12Rise();
    expect(mmc3.irqPending!()).toBe(false);

    // Enable IRQ
    mmc3.cpuWrite(0xE001, 0);

    // Next rise: 1->0 and now enabled -> IRQ
    mmc3.notifyA12Rise();
    expect(mmc3.irqPending!()).toBe(true);
  });

  it('multiple reload requests before a rise do not stack; only one reload occurs', () => {
    const mmc3 = new MMC3(new Uint8Array(0x8000));
    mmc3.cpuWrite(0xC000, 3);

    // spam C001, still only next rise performs single reload
    mmc3.cpuWrite(0xC001, 0);
    mmc3.cpuWrite(0xC001, 0);
    mmc3.cpuWrite(0xC001, 0);

    mmc3.cpuWrite(0xE001, 0);

    // First rise -> reload 3 (no irq)
    mmc3.notifyA12Rise(); expect(mmc3.irqPending!()).toBe(false);
    // Then 2,1,0 -> irq
    mmc3.notifyA12Rise(); expect(mmc3.irqPending!()).toBe(false);
    mmc3.notifyA12Rise(); expect(mmc3.irqPending!()).toBe(false);
    mmc3.notifyA12Rise(); expect(mmc3.irqPending!()).toBe(true);
  });
});

